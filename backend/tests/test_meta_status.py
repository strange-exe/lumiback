"""GET /meta/status: the developer's status panel. Real developers only (checked on the account
itself, also while they view the app as a role); it says which build is running and whether the
database is migrated, and nothing else: no settings, addresses or secrets."""

import asyncio
import json
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.api import meta
from app.api.meta import migration_head
from app.config import Settings
from app.email import MemoryMailer
from app.main import create_app
from tests.conftest import BACKEND, FAKE_SECRET
from tests.helpers import make_admin, signup
from tests.test_view_as import DEVELOPERS_ONLY, HEADER, ROLES, make_developer

PATH = "/meta/status"
DEVELOPERS = "Developers only"
COMMIT = "0123456789abcdef0123456789abcdef01234567"
KEYS = {"api_version", "commit", "database", "server_time"}
DATABASE_KEYS = {"reachable", "revision", "head", "up_to_date"}


def expected_head() -> str:
    script = ScriptDirectory.from_config(Config(str(BACKEND / "alembic.ini")))
    heads = script.get_heads()
    assert len(heads) == 1
    return heads[0]


@pytest.fixture
def dev(client, db):
    user, headers = signup(client, "dev@example.com", "Dev Eloper")
    make_developer(db, "dev@example.com")
    return user, headers


def test_a_developer_sees_the_build_and_the_migration(client, dev):
    before = datetime.now(UTC)
    r = client.get(PATH, headers=dev[1])
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == KEYS
    assert body["api_version"] == client.app.version
    assert body["commit"] is None  # not on Render: nothing set
    head = expected_head()
    assert body["database"] == {
        "reachable": True,
        "revision": head,
        "head": head,
        "up_to_date": True,
    }
    at = datetime.fromisoformat(body["server_time"])
    assert at.tzinfo is not None
    assert before.replace(microsecond=0) <= at.astimezone(UTC)


@pytest.mark.parametrize("viewed", ROLES)
def test_it_answers_a_developer_viewing_as_any_role(client, dev, viewed):
    """A GET, so view as allows it; the account behind it is still the developer."""
    r = client.get(PATH, headers={**dev[1], HEADER: viewed})
    assert r.status_code == 200, r.text
    assert set(r.json()) == KEYS


@pytest.mark.parametrize("role", ["student", "warden", "head_warden", "admin"])
def test_everyone_else_is_refused(client, db, role):
    _, headers = signup(client, "someone@example.com", "Someone")
    db.execute(text("UPDATE users SET role = :r WHERE email = 'someone@example.com'"), {"r": role})
    db.commit()
    r = client.get(PATH, headers=headers)
    assert (r.status_code, r.json()["detail"]) == (403, DEVELOPERS)
    # Sending the view as header doesn't make anyone a developer.
    r = client.get(PATH, headers={**headers, HEADER: "admin"})
    assert (r.status_code, r.json()["detail"]) == (403, DEVELOPERS_ONLY)


def test_an_admin_is_refused_too(client, db):
    _, headers = signup(client, "admin@example.com", "Asha Admin")
    make_admin(db, "admin@example.com")
    assert client.get(PATH, headers=headers).status_code == 403


def test_signed_out_is_a_401(client):
    assert client.get(PATH).status_code == 401
    assert client.get(PATH, headers={"Authorization": "Bearer not-a-token"}).status_code == 401


def test_a_demoted_developer_is_refused_at_once(client, db, dev):
    assert client.get(PATH, headers=dev[1]).status_code == 200
    db.execute(text("UPDATE users SET role = 'admin' WHERE email = 'dev@example.com'"))
    db.commit()
    assert client.get(PATH, headers=dev[1]).status_code == 403


def test_only_reads(client):
    """Nothing else is served under /meta/status."""
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        assert client.request(method, PATH).status_code == 405, method


def test_render_sets_the_commit(settings, clean_db, client_for):
    with client_for(settings.model_copy(update={"render_git_commit": COMMIT})) as (c, headers):
        assert c.get(PATH, headers=headers).json()["commit"] == COMMIT


@pytest.mark.parametrize("value", ["", "main", "not a sha", "abc", "g" * 40, "a" * 41, "<b>x</b>"])
def test_a_commit_that_is_not_a_sha_is_dropped(test_db_url, value):
    s = Settings(
        _env_file=None,  # type: ignore[call-arg]
        database_url=test_db_url,
        jwt_secret=FAKE_SECRET,
        code_pepper=FAKE_SECRET[::-1],
        cors_origins="http://localhost:3000",
        app_env="development",
        render_git_commit=value,
    )
    assert s.render_git_commit is None


def test_the_commit_is_read_from_render_git_commit(test_db_url, monkeypatch):
    monkeypatch.setenv("RENDER_GIT_COMMIT", COMMIT[:12])
    s = Settings(
        _env_file=None,  # type: ignore[call-arg]
        database_url=test_db_url,
        jwt_secret=FAKE_SECRET,
        code_pepper=FAKE_SECRET[::-1],
        cors_origins="http://localhost:3000",
        app_env="development",
    )
    assert s.render_git_commit == COMMIT[:12]


def test_a_database_behind_the_code_says_so(client, db, dev, test_db_url):
    head = expected_head()
    db.execute(text("UPDATE alembic_version SET version_num = '0000_older'"))
    db.commit()
    try:
        body = client.get(PATH, headers=dev[1]).json()["database"]
        assert body == {
            "reachable": True,
            "revision": "0000_older",
            "head": head,
            "up_to_date": False,
        }
    finally:
        db.execute(text("UPDATE alembic_version SET version_num = :v"), {"v": head})
        db.commit()


def test_an_unreachable_database_is_reported_not_raised(client, dev, monkeypatch):
    """The account check has already used the database; the status read then fails."""

    async def broken(_session):
        raise ConnectionError("database down at db.internal:5432")

    monkeypatch.setattr(meta, "read_revision", broken)
    r = client.get(PATH, headers=dev[1])
    assert r.status_code == 200
    assert r.json()["database"] == {
        "reachable": False,
        "revision": None,
        "head": expected_head(),
        "up_to_date": False,
    }
    assert "db.internal" not in r.text  # the error itself is never passed on


def test_the_expected_head_comes_from_the_migration_scripts():
    assert migration_head() == expected_head()
    assert Path(BACKEND / "migrations" / "versions").is_dir()


def test_nothing_secret_or_environmental_is_in_the_answer(settings, clean_db, client_for):
    with client_for(settings.model_copy(update={"render_git_commit": COMMIT})) as (c, headers):
        raw = c.get(PATH, headers=headers).text
    body = json.loads(raw)
    assert set(body) == KEYS
    assert set(body["database"]) == DATABASE_KEYS
    lowered = raw.lower()
    for secret in (
        FAKE_SECRET,
        FAKE_SECRET[::-1],
        settings.database_url.get_secret_value(),
        "outing_test",  # the database user and name
        "localhost",
        "127.0.0.1",
        "postgresql",
        "http://",
        "https://",
        "secret",
        "password",
        "env",
        "host",
    ):
        assert secret.lower() not in lowered, secret


@pytest.fixture
def client_for(clean_db):
    """A client for an app built from other settings, signed in as a developer."""

    @contextmanager
    def make(settings: Settings):
        app = create_app(settings, start_jobs=False)
        app.state.mailer = MemoryMailer()
        with TestClient(app, backend_options={"loop_factory": asyncio.SelectorEventLoop}) as c:
            _, headers = signup(c, "dev@example.com", "Dev Eloper")
            with clean_db.begin() as conn:
                conn.execute(
                    text("UPDATE users SET role = 'developer' WHERE email = :e"),
                    {"e": "dev@example.com"},
                )
            yield c, headers

    return make
