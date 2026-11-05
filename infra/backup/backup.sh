#!/usr/bin/env bash
# Nightly database backup: pg_dump -> encrypt -> Supabase Storage -> prune old copies.
#
# Run by .github/workflows/backup.yml. Reads everything from the environment:
#   DATABASE_URL          required. Postgres URL (a postgresql+psycopg:// scheme is accepted).
#   BACKUP_PASSPHRASE     required, at least 20 characters. Dumps hold personal data.
#   SUPABASE_URL          required. https://<project-ref>.supabase.co
#   SUPABASE_SERVICE_KEY  required. Secret key (sb_secret_...) or legacy service_role JWT.
#   PG_MAJOR              server major version the client must match (default 17).
#   BACKUP_BUCKET         private bucket name (default backups).
#   BACKUP_PREFIX         object name prefix (default lumiback).
#   BACKUP_SCHEMA         schema to dump (default public: the app's tables and alembic_version;
#                         Supabase's own schemas such as auth and storage are not ours).
#   KEEP_DAYS             backups older than this are deleted (default 14).
#   PYTHON                interpreter for JSON handling (default python3).
#
# Objects are named <prefix>-YYYY-MM-DDTHHMMZ.dump.enc at the top of the bucket. Pruning only
# ever touches names of that exact shape, and only after this run's upload shows in the listing.
#
# Encryption: openssl enc -aes-256-cbc with PBKDF2 (600000 iterations) and a random salt.
# openssl enc has no authenticated mode, so a tampered file is caught by pg_restore failing
# to read it, not by the cipher. The bucket is private; that is the trade-off for no new tools.
#
# ---------------------------------------------------------------------------------------------
# RESTORE (run on your own machine; needs openssl and the PostgreSQL client of the same major)
#
#   1. Download the object: Supabase dashboard > Storage > backups > the newest file > Download.
#   2. Decrypt (the passphrase is read from the environment, never typed on the command line):
#        read -rs BACKUP_PASSPHRASE && export BACKUP_PASSPHRASE
#        openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_PASSPHRASE \
#          -in lumiback-2026-11-05T2047Z.dump.enc -out lumiback.dump
#   3. Check it reads:   pg_restore --list lumiback.dump | head
#   4. Restore into an EMPTY database first and look at it before touching production:
#        createdb lumiback_restore
#        pg_restore --no-owner --no-privileges --exit-on-error -d lumiback_restore lumiback.dump
#   5. To replace production, stop the API (Render: suspend lumiback-api), then restore with
#        pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error \
#          -d "<session pooler URL, postgresql:// scheme>" lumiback.dump
#      and resume the API. Migrations then run as usual on start.
#   6. Delete the decrypted lumiback.dump when done.
# ---------------------------------------------------------------------------------------------

set -euo pipefail
set +x  # never trace: commands below carry the database URL and keys

die() {
  echo "backup: $*" >&2
  exit 1
}

: "${DATABASE_URL:?DATABASE_URL is not set}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set}"
: "${SUPABASE_URL:?SUPABASE_URL is not set}"
: "${SUPABASE_SERVICE_KEY:?SUPABASE_SERVICE_KEY is not set}"
PG_MAJOR="${PG_MAJOR:-17}"
BACKUP_BUCKET="${BACKUP_BUCKET:-backups}"
BACKUP_PREFIX="${BACKUP_PREFIX:-lumiback}"
BACKUP_SCHEMA="${BACKUP_SCHEMA:-public}"
KEEP_DAYS="${KEEP_DAYS:-14}"
PYTHON="${PYTHON:-python3}"

[[ ${#BACKUP_PASSPHRASE} -ge 20 ]] || die "BACKUP_PASSPHRASE must be at least 20 characters"
[[ $PG_MAJOR =~ ^[0-9]+$ ]] || die "PG_MAJOR must be a number, got '$PG_MAJOR'"
[[ $KEEP_DAYS =~ ^[0-9]+$ && $KEEP_DAYS -ge 1 ]] || die "KEEP_DAYS must be a whole number >= 1"
[[ $BACKUP_BUCKET =~ ^[a-z0-9._-]+$ ]] || die "BACKUP_BUCKET has unexpected characters"
[[ $BACKUP_PREFIX =~ ^[a-z0-9_-]+$ ]] || die "BACKUP_PREFIX has unexpected characters"
SUPABASE_URL="${SUPABASE_URL%/}"
[[ $SUPABASE_URL =~ ^https?://[^/[:space:]]+$ ]] || die "SUPABASE_URL must look like https://<ref>.supabase.co"

# SQLAlchemy URLs (postgresql+psycopg://) are not libpq URLs: drop the driver part.
db_url="$DATABASE_URL"
if [[ $db_url =~ ^(postgres(ql)?)\+[a-z0-9_]+:// ]]; then
  db_url="postgresql://${db_url#*://}"
fi
[[ $db_url =~ ^postgres(ql)?:// ]] || die "DATABASE_URL must be a postgresql:// URL"

if [[ ${GITHUB_ACTIONS:-} == "true" ]]; then
  # Secrets are masked by Actions already; this rewritten URL is a new string, so mask it too.
  echo "::add-mask::$db_url"
fi

# Host, for the TLS default and messages: strip scheme, credentials, then port/path/query.
host="${db_url#*://}"
host="${host##*@}"
host="${host%%[/?]*}"
if [[ $host == \[* ]]; then
  host="${host%%]*}]" # [IPv6]:port
else
  host="${host%:*}"
fi
case "$host" in
  localhost | 127.0.0.1 | "[::1]" | "") is_local=1 ;;
  *) is_local=0 ;;
esac
if [[ $is_local -eq 0 ]]; then
  export PGSSLMODE="${PGSSLMODE:-require}"
fi
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-20}"

for tool in pg_dump pg_restore psql openssl curl "$PYTHON"; do
  command -v "$tool" >/dev/null || die "$tool is not installed"
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
chmod 700 "$work"

# --- 1. Versions: the client must match the server's major version -------------------------
client_version="$(pg_dump --version)"
[[ $client_version =~ ([0-9]+)\.[0-9]+ ]] || die "cannot read the pg_dump version"
client_major="${BASH_REMATCH[1]}"
if [[ $client_major != "$PG_MAJOR" ]]; then
  die "pg_dump is version $client_major but PG_MAJOR is $PG_MAJOR; install postgresql-client-$PG_MAJOR"
fi

server_num="$(psql --no-psqlrc --tuples-only --no-align --quiet \
  --dbname="$db_url" --command="show server_version_num")" ||
  die "cannot connect to the database (check DATABASE_URL_BACKUP)"
[[ $server_num =~ ^[0-9]+$ ]] || die "unexpected server_version_num"
server_major=$((server_num / 10000))
if [[ $server_major != "$PG_MAJOR" ]]; then
  die "the database runs PostgreSQL $server_major but PG_MAJOR is $PG_MAJOR; set the repository variable PG_MAJOR to $server_major"
fi
echo "PostgreSQL $server_major on the server, pg_dump $client_major on this runner"

# --- 2. Dump --------------------------------------------------------------------------------
stamp="$(date -u +%Y-%m-%dT%H%MZ)"
name="${BACKUP_PREFIX}-${stamp}.dump.enc"
dump="$work/db.dump"
enc="$work/$name"

# Custom format (compressed, restorable selectively). No owners or grants: Supabase role names
# would make a restore anywhere else fail.
pg_dump --format=custom --no-owner --no-privileges --schema="$BACKUP_SCHEMA" \
  --dbname="$db_url" --file="$dump" || die "pg_dump failed"
tables="$(pg_restore --list "$dump" | grep -c ' TABLE DATA ' || true)"
echo "dumped schema $BACKUP_SCHEMA: $tables tables, $(wc -c <"$dump" | tr -d ' ') bytes"

# --- 3. Encrypt, then prove the encrypted file decrypts back to a readable dump ---------------
openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass env:BACKUP_PASSPHRASE \
  -in "$dump" -out "$enc" || die "encryption failed"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_PASSPHRASE \
  -in "$enc" -out "$work/check.dump" || die "the encrypted file does not decrypt"
cmp -s "$dump" "$work/check.dump" || die "decrypted file differs from the dump"
pg_restore --list "$work/check.dump" >/dev/null || die "decrypted dump is not readable"
rm -f "$dump" "$work/check.dump"

# --- 4. Supabase Storage (REST) -------------------------------------------------------------
# Keys go in a header file, not on curl's command line, so they never show in a process list.
# New secret keys are sent as `apikey` only; they are not JWTs and fail as a Bearer token
# (https://supabase.com/docs/guides/api/api-keys). Legacy service_role JWTs go in both.
headers="$work/headers"
(
  umask 077
  printf 'apikey: %s\n' "$SUPABASE_SERVICE_KEY" >"$headers"
  if [[ $SUPABASE_SERVICE_KEY == eyJ* ]]; then
    printf 'Authorization: Bearer %s\n' "$SUPABASE_SERVICE_KEY" >>"$headers"
  fi
)
storage="$SUPABASE_URL/storage/v1"

storage_call() { # method path [curl args...]; prints the response body, fails on HTTP >= 400
  local method="$1" path="$2"
  shift 2
  # --retry covers timeouts, 429 and 5xx only; a 4xx (bad key, name exists) fails at once.
  curl --silent --show-error --fail-with-body --retry 3 --retry-connrefused --max-time 600 \
    --header @"$headers" --request "$method" "$storage$path" "$@"
}

# Upload: POST /storage/v1/object/{bucket}/{path}. No x-upsert, so an existing name is an
# error rather than an overwrite. Standard upload, fine for files up to the project's file
# size limit (https://supabase.com/docs/guides/storage/uploads/standard-uploads).
storage_call POST "/object/$BACKUP_BUCKET/$name" \
  --header "Content-Type: application/octet-stream" \
  --data-binary @"$enc" >/dev/null || die "upload failed"
echo "uploaded $name ($(wc -c <"$enc" | tr -d ' ') bytes) to bucket $BACKUP_BUCKET"

# List: POST /storage/v1/object/list/{bucket} with {prefix, limit, offset, sortBy}
# (https://supabase.com/docs/reference/javascript/storage-from-list is the client for it;
# route source: github.com/supabase/storage src/http/routes/object/listObjects.ts).
storage_call POST "/object/list/$BACKUP_BUCKET" \
  --header "Content-Type: application/json" \
  --data '{"prefix":"","limit":1000,"offset":0,"sortBy":{"column":"created_at","order":"asc"}}' \
  >"$work/list.json" || die "listing the bucket failed"

# Pick what to prune. Exits 3 if this run's upload is missing from the listing.
old="$work/old.json"
"$PYTHON" -I -c '
import json, re, sys
from datetime import datetime, timedelta, timezone

listing, prefix, keep_days, current = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
shape = re.compile(re.escape(prefix) + r"-\d{4}-\d{2}-\d{2}T\d{4}Z\.dump\.enc")
cutoff = datetime.now(timezone.utc) - timedelta(days=keep_days)
items = json.load(open(listing, encoding="utf-8"))
names = {i.get("name") for i in items if i.get("id")}  # folders have no id
if current not in names:
    sys.exit(3)
old = []
for i in items:
    name, created = i.get("name") or "", i.get("created_at")
    if not i.get("id") or name == current or not shape.fullmatch(name) or not created:
        continue
    when = datetime.fromisoformat(created.replace("Z", "+00:00"))
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    if when < cutoff:
        old.append(name)
json.dump({"prefixes": old}, sys.stdout)
' "$work/list.json" "$BACKUP_PREFIX" "$KEEP_DAYS" "$name" >"$old" ||
  die "this run's upload is not in the bucket listing; nothing pruned"

count="$("$PYTHON" -I -c 'import json, sys; print(len(json.load(open(sys.argv[1]))["prefixes"]))' "$old")"
if [[ $count -gt 0 ]]; then
  # Delete: DELETE /storage/v1/object/{bucket} with {"prefixes": [...]}
  # (route source: github.com/supabase/storage src/http/routes/object/deleteObjects.ts).
  storage_call DELETE "/object/$BACKUP_BUCKET" \
    --header "Content-Type: application/json" \
    --data @"$old" >/dev/null || die "pruning old backups failed"
fi
echo "pruned $count backup(s) older than $KEEP_DAYS days"
