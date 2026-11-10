"""Run `alembic upgrade head` at start-up only when the database is behind the code.

Render's free plan starts the API on every wake from sleep, and running alembic each time costs
a second full Python start (alembic, SQLAlchemy and every model imported) before uvicorn even
begins. Migrations only change with a deploy, so (render.yaml):

    build:  .venv/bin/python scripts/migrate_if_behind.py record
            writes the code's migration head to .migration-head (gitignored)
    start:  { .venv/bin/python scripts/migrate_if_behind.py check ||
              .venv/bin/alembic upgrade head; } && exec .venv/bin/uvicorn ...

`check` exits 0 only when it is sure: the recorded head is one plain revision id AND the
database's alembic_version holds exactly that one revision. Anything else (no head file, a
merge of several heads, no alembic_version table, an empty one, a connection error, a bad
setting, any crash) exits non-zero, and the shell then runs alembic exactly as before. So the
worst case is today's behaviour, never a skipped migration.

Nothing here prints the database URL or an error's text (a driver error can name the host);
only the error's type.

    uv run python scripts/migrate_if_behind.py check --db test   # local *_test database
"""

import argparse
import re
import sys
from collections.abc import Callable, Sequence
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlsplit

BACKEND = Path(__file__).resolve().parents[1]
HEAD_FILE = BACKEND / ".migration-head"
ALEMBIC_INI = BACKEND / "alembic.ini"
REVISION_ID = re.compile(r"[A-Za-z0-9_]{1,64}")
CONNECT_TIMEOUT_SECONDS = 10
SCHEME = "postgresql+psycopg"  # the only scheme app/config.py accepts


def say(message: str) -> None:
    print(f"migrate_if_behind: {message}", file=sys.stderr, flush=True)


def record_head(head_file: Path = HEAD_FILE, alembic_ini: Path = ALEMBIC_INI) -> str:
    """Write the code's migration head(s), as alembic itself reads them from migrations/."""
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    head_file.unlink(missing_ok=True)  # a failed run must never leave an older head behind
    heads = ScriptDirectory.from_config(Config(str(alembic_ini))).get_heads()
    text = ",".join(sorted(heads))
    head_file.write_text(text + "\n", encoding="ascii")
    return text


def read_recorded_head(head_file: Path = HEAD_FILE) -> str | None:
    """The single recorded head, or None when missing, several (a merge) or malformed."""
    try:
        text = head_file.read_text(encoding="ascii").strip()
    except (OSError, UnicodeError):
        return None
    return text if REVISION_ID.fullmatch(text) else None


def connect_kwargs(url: str) -> dict[str, str | int]:
    """psycopg keyword arguments for a postgresql+psycopg:// URL, decoded the way SQLAlchemy
    decodes it (percent-escapes in the user and password, query options passed through)."""
    parts = urlsplit(url)
    if parts.scheme != SCHEME or not parts.hostname:
        raise ValueError("unexpected database URL")
    kwargs: dict[str, str | int] = {
        "host": parts.hostname,
        "dbname": unquote(parts.path.lstrip("/")),
        "connect_timeout": CONNECT_TIMEOUT_SECONDS,
    }
    if parts.port:
        kwargs["port"] = parts.port
    if parts.username:
        kwargs["user"] = unquote(parts.username)
    if parts.password:
        kwargs["password"] = unquote(parts.password)
    kwargs.update(parse_qsl(parts.query))
    return kwargs


def database_revisions(url: str) -> list[str]:
    """Every row of alembic_version (psycopg only: no SQLAlchemy, no alembic, no models)."""
    import psycopg

    with psycopg.connect(**connect_kwargs(url)) as conn:  # type: ignore[arg-type]
        rows = conn.execute("SELECT version_num FROM alembic_version").fetchall()
    return [row[0] for row in rows]


def up_to_date(head: str | None, revisions: Sequence[str]) -> bool:
    return head is not None and list(revisions) == [head]


def check(
    load_url: Callable[[], str],
    read_revisions: Callable[[str], Sequence[str]] = database_revisions,
    head_file: Path = HEAD_FILE,
) -> bool:
    """True only when the database is certainly at the recorded head. Never raises."""
    head = read_recorded_head(head_file)
    if head is None:
        say("no single recorded head; running alembic")
        return False
    try:
        revisions = read_revisions(load_url())
    # Missing table, connection refused, invalid settings (ConfigError is a SystemExit): alembic
    # runs and reports the real problem itself.
    except (Exception, SystemExit) as e:
        say(f"could not read the database revision ({type(e).__name__}); running alembic")
        return False
    if up_to_date(head, revisions):
        say(f"database already at {head}; skipping alembic")
        return True
    say("database is not at the code's head; running alembic")
    return False


def settings_url(db: str | None) -> Callable[[], str]:
    """The URL the app (or `alembic -x db=test`) would use, loaded through the app's settings."""

    def load() -> str:
        sys.path.insert(0, str(BACKEND))
        from app.config import TestDbSettings, load_settings

        if db == "test":
            return TestDbSettings().test_database_url.get_secret_value()  # type: ignore[call-arg]
        return load_settings().database_url.get_secret_value()

    return load


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("action", choices=["record", "check"])
    parser.add_argument("--db", choices=["test"], help="use TEST_DATABASE_URL, like alembic -x")
    args = parser.parse_args(argv)
    if args.action == "record":
        say(f"recorded head {record_head()}")
        return 0
    return 0 if check(settings_url(args.db), database_revisions, HEAD_FILE) else 1


if __name__ == "__main__":
    sys.exit(main())
