"""scripts/migrate_if_behind.py: start-up skips alembic only when the database is certainly at
the code's head; every doubt runs alembic as before. Fakes only: no database, no network."""

import importlib.util
from pathlib import Path

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory

BACKEND = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location(
    "migrate_if_behind", BACKEND / "scripts" / "migrate_if_behind.py"
)
assert _spec is not None and _spec.loader is not None
gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gate)

URL = "postgresql+psycopg://app:secret@db.example.com:6543/postgres"


def head_file(tmp_path: Path, text: str) -> Path:
    path = tmp_path / ".migration-head"
    path.write_text(text, encoding="ascii")
    return path


def revisions(*rows: str):
    def read(url: str) -> list[str]:
        assert url == URL
        return list(rows)

    return read


def failing(error: BaseException):
    def read(_url: str) -> list[str]:
        raise error

    return read


def test_same_head_skips_alembic(tmp_path):
    assert gate.check(lambda: URL, revisions("0034"), head_file(tmp_path, "0034\n")) is True


@pytest.mark.parametrize(
    "rows",
    [("0033",), ("0035",), (), ("0034", "0034"), ("0034", "0033")],
    ids=["behind", "ahead", "empty table", "duplicate row", "two rows"],
)
def test_any_other_database_state_runs_alembic(tmp_path, rows):
    assert gate.check(lambda: URL, revisions(*rows), head_file(tmp_path, "0034\n")) is False


@pytest.mark.parametrize("text", ["", "\n", "0033,0034\n", "0034 (head)\n", "../etc\n"], ids=repr)
def test_a_missing_merged_or_odd_head_runs_alembic(tmp_path, text):
    read = failing(AssertionError("the database is not even asked"))
    assert gate.check(lambda: URL, read, head_file(tmp_path, text)) is False


def test_no_head_file_runs_alembic(tmp_path):
    read = failing(AssertionError("the database is not even asked"))
    assert gate.check(lambda: URL, read, tmp_path / "missing") is False


class UndefinedTable(Exception):
    """Stands in for psycopg.errors.UndefinedTable (a fresh database)."""


@pytest.mark.parametrize(
    "error",
    [UndefinedTable("relation does not exist"), OSError("refused"), TimeoutError()],
    ids=["no table", "connection error", "timeout"],
)
def test_a_database_error_runs_alembic(tmp_path, error):
    assert gate.check(lambda: URL, failing(error), head_file(tmp_path, "0034")) is False


def test_bad_settings_run_alembic(tmp_path):
    def load_url() -> str:
        raise SystemExit("Refusing to start: invalid configuration")  # like app.config.ConfigError

    assert gate.check(load_url, revisions("0034"), head_file(tmp_path, "0034")) is False


def test_errors_are_named_by_type_never_by_text(tmp_path, capsys):
    leak = OSError(f"could not connect to {URL}")
    gate.check(lambda: URL, failing(leak), head_file(tmp_path, "0034"))
    err = capsys.readouterr().err
    assert "OSError" in err
    assert "secret" not in err and "db.example.com" not in err


def test_recording_writes_alembics_own_head(tmp_path):
    path = tmp_path / ".migration-head"
    path.write_text("0001\n", encoding="ascii")  # an older build's head never survives
    written = gate.record_head(path)
    expected = ScriptDirectory.from_config(Config(str(BACKEND / "alembic.ini"))).get_heads()
    assert [written] == expected
    assert gate.read_recorded_head(path) == expected[0]


def test_connect_kwargs_decode_the_url_like_sqlalchemy():
    url = "postgresql+psycopg://us%40er:p%40ss%3Aw@db.example.com:6543/post%67res?sslmode=require"
    assert gate.connect_kwargs(url) == {
        "host": "db.example.com",
        "port": 6543,
        "user": "us@er",
        "password": "p@ss:w",
        "dbname": "postgres",
        "sslmode": "require",
        "connect_timeout": gate.CONNECT_TIMEOUT_SECONDS,
    }


@pytest.mark.parametrize(
    "url", ["postgresql://u:p@h/d", "sqlite:///x.db", "postgresql+psycopg:///d"]
)
def test_connect_kwargs_refuse_other_urls(url):
    with pytest.raises(ValueError):
        gate.connect_kwargs(url)


def test_main_exit_code_is_zero_only_when_up_to_date(tmp_path, monkeypatch):
    monkeypatch.setattr(gate, "HEAD_FILE", head_file(tmp_path, "0034"))
    monkeypatch.setattr(gate, "settings_url", lambda _db: lambda: URL)
    monkeypatch.setattr(gate, "database_revisions", revisions("0034"))
    assert gate.main(["check"]) == 0
    monkeypatch.setattr(gate, "database_revisions", revisions("0033"))
    assert gate.main(["check"]) == 1
