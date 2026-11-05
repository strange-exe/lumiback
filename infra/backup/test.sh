#!/usr/bin/env bash
# Local test for backup.sh: real pg_dump of a LOCAL *_test database (read-only), a fake
# Supabase Storage server (fake_storage.py), and a decrypt + pg_restore --list check.
#
#   BACKUP_TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/outing_test \
#     PG_MAJOR=17 bash infra/backup/test.sh
#
# Needs pg_dump, pg_restore and psql of PG_MAJOR on PATH, openssl, curl and Python 3.11+
# (PYTHON, default python3). Refuses any database that is not local or not named *_test.

set -euo pipefail
set +x

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${BACKUP_TEST_DATABASE_URL:?set BACKUP_TEST_DATABASE_URL to a local *_test database}"
export PYTHON="${PYTHON:-python3}"
export PG_MAJOR="${PG_MAJOR:-17}"

url="$BACKUP_TEST_DATABASE_URL"
url="postgresql://${url#*://}"
host="${url#*://}"
host="${host##*@}"
db="${host#*/}"
db="${db%%\?*}"
host="${host%%[/?]*}"
host="${host%:*}"
case "$host" in
  localhost | 127.0.0.1) ;;
  *) echo "refusing: the test database must be on localhost" >&2 && exit 2 ;;
esac
[[ $db == *_test ]] || { echo "refusing: the test database name must end in _test" >&2 && exit 2; }

work="$(mktemp -d)"
server_pid=""
cleanup() {
  [[ -n $server_pid ]] && kill "$server_pid" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

failures=0
pass() { echo "ok   $*"; }
fail() {
  echo "FAIL $*" >&2
  failures=$((failures + 1))
}

# Seed: two of ours (15 and 13 days old) plus two old objects that are not ours to delete.
mkdir -p "$work/store/objects"
"$PYTHON" -I -c '
import json, sys
from datetime import UTC, datetime, timedelta
now = datetime.now(UTC)
ago = lambda d: (now - timedelta(days=d)).isoformat().replace("+00:00", "Z")
json.dump({
    "lumiback-2026-01-01T2047Z.dump.enc": ago(15),
    "lumiback-2026-01-03T2047Z.dump.enc": ago(13),
    "notes.txt": ago(30),
    "other-2026-01-01T2047Z.dump.enc": ago(30),
}, open(sys.argv[1], "w"))
' "$work/store/index.json"

key="sb_secret_fake_local_test_key"
"$PYTHON" -I "$here/fake_storage.py" "$work/store" "$work/port" "$key" &
server_pid=$!
for _ in $(seq 50); do
  [[ -s $work/port ]] && break
  sleep 0.1
done
[[ -s $work/port ]] || { echo "fake storage did not start" >&2 && exit 1; }

export DATABASE_URL="$BACKUP_TEST_DATABASE_URL"
export SUPABASE_URL="http://127.0.0.1:$(cat "$work/port")"
export SUPABASE_SERVICE_KEY="$key"
export BACKUP_PASSPHRASE="local-test-passphrase-not-a-secret"

objects() { "$PYTHON" -I -c 'import json, sys; print(" ".join(sorted(json.load(open(sys.argv[1])))))' "$work/store/index.json"; }
before="$(objects)"

# 1. A version mismatch stops before dumping anything.
if PG_MAJOR=$((PG_MAJOR - 1)) bash "$here/backup.sh" >"$work/out" 2>&1; then
  fail "a PG_MAJOR mismatch should fail"
elif grep -q "PG_MAJOR" "$work/out" && [[ "$(objects)" == "$before" ]]; then
  pass "PG_MAJOR mismatch fails clearly and uploads nothing"
else
  fail "PG_MAJOR mismatch: unexpected output or upload"
fi

# 2. A short passphrase is refused.
if BACKUP_PASSPHRASE=short bash "$here/backup.sh" >"$work/out" 2>&1; then
  fail "a short passphrase should fail"
else
  pass "short passphrase refused"
fi

# 3. A wrong key fails the upload and prunes nothing.
if SUPABASE_SERVICE_KEY=sb_secret_wrong bash "$here/backup.sh" >"$work/out" 2>&1; then
  fail "a wrong storage key should fail"
elif grep -q "upload failed" "$work/out" && [[ "$(objects)" == "$before" ]]; then
  pass "wrong key: upload fails, nothing pruned"
else
  fail "wrong key: unexpected output or change"
fi

# 4. The real run: upload, list, prune.
if bash "$here/backup.sh" >"$work/out" 2>&1; then
  pass "backup run succeeded"
else
  fail "backup run failed:"
  cat "$work/out" >&2
fi
grep -qF "$BACKUP_PASSPHRASE" "$work/out" && fail "output contains the passphrase"
grep -qF "$key" "$work/out" && fail "output contains the storage key"
pw="$(printf '%s' "${url#*://}" | cut -d@ -f1 | cut -s -d: -f2)"
[[ -n $pw ]] && grep -qF "$pw" "$work/out" && fail "output contains the database password"

after="$(objects)"
new="$(printf '%s\n' $after | grep -E '^lumiback-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{4}Z\.dump\.enc$' |
  grep -v '^lumiback-2026-01-0' || true)"
[[ $(printf '%s\n' "$new" | grep -c .) -eq 1 ]] && pass "one new backup uploaded ($new)" ||
  fail "expected one new backup, got: $new"
[[ $after != *lumiback-2026-01-01T2047Z* ]] && pass "15-day-old backup pruned" ||
  fail "15-day-old backup was not pruned"
[[ $after == *lumiback-2026-01-03T2047Z* ]] && pass "13-day-old backup kept" ||
  fail "13-day-old backup was deleted"
[[ $after == *notes.txt* && $after == *other-2026-01-01T2047Z* ]] &&
  pass "objects that are not ours kept" || fail "deleted an object that is not ours"

# 5. The stored object decrypts and pg_restore can read it; table count matches the database.
if [[ -n $new && -f $work/store/objects/$new ]]; then
  if openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_PASSPHRASE \
    -in "$work/store/objects/$new" -out "$work/restored.dump" 2>/dev/null &&
    pg_restore --list "$work/restored.dump" >"$work/toc"; then
    listed="$(grep -c ' TABLE public ' "$work/toc" || true)"
    expected="$(psql --no-psqlrc -XAtq --dbname="$url" \
      --command="select count(*) from pg_tables where schemaname = 'public'")"
    [[ $listed == "$expected" ]] && pass "restorable dump lists all $listed public tables" ||
      fail "dump lists $listed tables, database has $expected"
  else
    fail "the uploaded object does not decrypt to a readable dump"
  fi
  if BACKUP_PASSPHRASE=wrong-passphrase-for-this-test openssl enc -d -aes-256-cbc -pbkdf2 \
    -iter 600000 -pass env:BACKUP_PASSPHRASE -in "$work/store/objects/$new" \
    -out "$work/wrong.dump" 2>/dev/null && pg_restore --list "$work/wrong.dump" >/dev/null 2>&1; then
    fail "a wrong passphrase still gave a readable dump"
  else
    pass "a wrong passphrase gives nothing readable"
  fi
fi

if [[ $failures -gt 0 ]]; then
  echo "$failures check(s) failed" >&2
  exit 1
fi
echo "all backup checks passed"
