from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from pydantic import ValidationError
from sqlalchemy import Connection, Engine, create_engine, text
from sqlalchemy.pool import NullPool

from app.config import TestDbSettings
from app.models import Base

BACKEND = Path(__file__).resolve().parents[1]


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
def db(migrated_engine: Engine) -> Connection:
    """A connection for one test; all tables are emptied afterwards."""
    with migrated_engine.connect() as conn:
        yield conn
        conn.rollback()
    tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
    with migrated_engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
