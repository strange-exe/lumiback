from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, text

from app.models import Base
from tests.conftest import alembic_config


def test_upgrade_creates_every_model_table(migrated_engine):
    tables = set(inspect(migrated_engine).get_table_names())
    assert set(Base.metadata.tables) <= tables


def test_models_and_migrations_do_not_drift(migrated_engine):
    with migrated_engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    assert diff == [], f"models differ from migrations; generate a new revision: {diff}"


def test_row_level_security_enabled_on_every_table(migrated_engine):
    # Supabase's Data API must never be able to read our tables (deny-all: RLS on, no policies).
    with migrated_engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT c.relname, c.relrowsecurity, "
                "(SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) "
                "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'alembic_version'"
            )
        ).all()
    assert {name for name, _, _ in rows} == set(Base.metadata.tables)
    assert [name for name, rls, _ in rows if not rls] == []
    assert [name for name, _, policies in rows if policies] == []


def test_downgrade_to_base_and_back(migrated_engine, test_db_url):
    cfg = alembic_config(test_db_url)
    command.downgrade(cfg, "base")
    assert set(inspect(migrated_engine).get_table_names()) <= {"alembic_version"}
    command.upgrade(cfg, "head")
    assert set(Base.metadata.tables) <= set(inspect(migrated_engine).get_table_names())
