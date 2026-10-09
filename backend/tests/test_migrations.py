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


def test_outing_rules_are_seeded_from_hostel_practice(migrated_engine, test_db_url):
    # The per-test reset replaces the seeds, so rebuild the schema to read them fresh.
    cfg = alembic_config(test_db_url)
    command.downgrade(cfg, "0013")
    command.upgrade(cfg, "head")
    with migrated_engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT s.name, d.day_type, d.opens_at::text, d.return_by::text, "
                "d.max_minutes, d.needs_form "
                "FROM day_rules d JOIN rule_sets s ON s.id = d.rule_set_id"
            )
        ).all()
        default = conn.execute(
            text(
                "SELECT s.name FROM campus_settings c JOIN rule_sets s "
                "ON s.id = c.default_rule_set_id"
            )
        ).scalar_one()
    rules = {(name, day): rest for name, day, *rest in rows}
    assert rules[("Boys' hostels", "weekday")] == ["18:00:00", "20:00:00", None, False]
    assert rules[("Girls' hostels", "weekday")] == ["18:00:00", "20:00:00", None, False]
    assert rules[("Boys' hostels", "sunday")] == ["10:00:00", "20:00:00", 180, True]
    assert rules[("Girls' hostels", "holiday")] == ["10:00:00", "20:00:00", 300, True]
    assert len(rules) == 8
    assert default == "Boys' hostels"
