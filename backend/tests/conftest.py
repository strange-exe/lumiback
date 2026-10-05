import asyncio
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import Connection, Engine, create_engine, text
from sqlalchemy.pool import NullPool

from app.config import Settings, TestDbSettings
from app.main import create_app
from app.models import Base

BACKEND = Path(__file__).resolve().parents[1]
FAKE_SECRET = "t3st-only-" + "x7Kq9Zp2" * 5


def alembic_config(url: str) -> Config:
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.attributes["url"] = url
    return cfg


@pytest.fixture(scope="session")
def test_db_url() -> str:
    try:
        settings = TestDbSettings(_env_file=BACKEND / ".env")  # type: ignore[call-arg]
    except ValidationError as e:
        reasons = "; ".join(err["msg"] for err in e.errors(include_input=False))
        pytest.fail(f"TEST_DATABASE_URL missing or unsafe: {reasons}", pytrace=False)
    return settings.test_database_url.get_secret_value()


@pytest.fixture(scope="session")
def migrated_engine(test_db_url: str) -> Engine:
    """Fresh schema built by running the real migrations (so migrations are tested too)."""
    engine = create_engine(test_db_url, poolclass=NullPool)
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    command.upgrade(alembic_config(test_db_url), "head")
    yield engine
    engine.dispose()


@pytest.fixture
def clean_db(migrated_engine: Engine) -> Engine:
    """Empties every table after the test."""
    yield migrated_engine
    tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
    with migrated_engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))


@pytest.fixture
def db(clean_db: Engine) -> Connection:
    with clean_db.connect() as conn:
        yield conn
        conn.rollback()


@pytest.fixture
def settings(test_db_url: str) -> Settings:
    return Settings(
        _env_file=None,  # type: ignore[call-arg]
        database_url=test_db_url,
        jwt_secret=FAKE_SECRET,
        code_pepper=FAKE_SECRET[::-1],
        cors_origins="http://localhost:3000",
        app_env="development",
    )


@pytest.fixture
def client(settings: Settings, clean_db: Engine) -> TestClient:
    # psycopg async needs a selector loop (Windows default is Proactor).
    with TestClient(
        create_app(settings, start_jobs=False),
        backend_options={"loop_factory": asyncio.SelectorEventLoop},
    ) as c:
        yield c
