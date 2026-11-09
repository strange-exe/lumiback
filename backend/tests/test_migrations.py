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


def test_0030_quiets_open_escalations_and_moves_staff_out_of_hostels(migrated_engine, test_db_url):
    """Escalations open before the follow-up existed don't all re-alert or hand over in the
    first sweep; staff live in no hostel (promotion clears it, owner 2026-11-08)."""
    cfg = alembic_config(test_db_url)
    command.downgrade(cfg, "0029")
    try:
        with migrated_engine.begin() as conn:
            rule_set = conn.execute(
                text("INSERT INTO rule_sets (name) VALUES ('0030 test') RETURNING id")
            ).scalar_one()
            hostel = conn.execute(
                text("INSERT INTO hostels (name, rule_set_id) VALUES ('0030 H', :r) RETURNING id"),
                {"r": rule_set},
            ).scalar_one()
            users = {
                role: conn.execute(
                    text(
                        "INSERT INTO users (role, name, email, password_hash, hostel_id) "
                        "VALUES (:role, 'X', :email, 'x', :h) RETURNING id"
                    ),
                    {"role": role, "email": f"{role}.0030@example.com", "h": hostel},
                ).scalar_one()
                for role in ("student", "warden", "admin")
            }
            outing = conn.execute(
                text(
                    "INSERT INTO outings (student_id, left_at, expected_return_at, hostel_id) "
                    "VALUES (:s, now() - interval '5 hours', now() - interval '3 hours', :h) "
                    "RETURNING id"
                ),
                {"s": users["student"], "h": hostel},
            ).scalar_one()
            conn.execute(
                text(
                    "INSERT INTO escalations (outing_id, created_at) "
                    "VALUES (:o, now() - interval '2 hours')"
                ),
                {"o": outing},
            )
        command.upgrade(cfg, "head")
        with migrated_engine.connect() as conn:
            realerted, handed_over = conn.execute(
                text("SELECT realerted_at, handed_over_at FROM escalations WHERE outing_id = :o"),
                {"o": outing},
            ).one()
            homes = dict(
                conn.execute(
                    text("SELECT role, hostel_id FROM users WHERE email LIKE '%.0030@example.com'")
                ).all()
            )
        assert realerted is not None and handed_over is not None
        assert homes == {"student": hostel, "warden": None, "admin": None}
    finally:
        command.upgrade(cfg, "head")
        with migrated_engine.begin() as conn:
            mine = "SELECT id FROM users WHERE email LIKE '%.0030@example.com'"
            conn.execute(text(f"DELETE FROM outings WHERE student_id IN ({mine})"))
            conn.execute(text("DELETE FROM users WHERE email LIKE '%.0030@example.com'"))
            conn.execute(text("DELETE FROM hostels WHERE name = '0030 H'"))
            conn.execute(text("DELETE FROM rule_sets WHERE name = '0030 test'"))


def test_0033_copies_earlier_announcements_into_the_history(migrated_engine, test_db_url):
    """Announcements sent before wave 5 appear in the history, with what the audit log kept."""
    cfg = alembic_config(test_db_url)
    command.downgrade(cfg, "0032")
    try:
        with migrated_engine.begin() as conn:
            dev = conn.execute(
                text(
                    "INSERT INTO users (role, name, email, password_hash) "
                    "VALUES ('developer', 'Dev', 'dev.0033@example.com', 'x') RETURNING id"
                )
            ).scalar_one()
            conn.execute(
                text(
                    "INSERT INTO admin_audit (actor_id, action, target) VALUES "
                    "(:d, 'announce:update', 'Lumiback 1.18.0'), (:d, 'gate:create', 'Main')"
                ),
                {"d": dev},
            )
        command.upgrade(cfg, "head")
        with migrated_engine.connect() as conn:
            rows = conn.execute(
                text("SELECT actor_id, kind, title, body, roles, devices FROM announcements")
            ).all()
        assert [tuple(r) for r in rows] == [(dev, None, "Lumiback 1.18.0", None, None, None)]
    finally:
        command.upgrade(cfg, "head")
        with migrated_engine.begin() as conn:
            mine = "SELECT id FROM users WHERE email = 'dev.0033@example.com'"
            conn.execute(text(f"DELETE FROM announcements WHERE actor_id IN ({mine})"))
            conn.execute(text(f"DELETE FROM admin_audit WHERE actor_id IN ({mine})"))
            conn.execute(text("DELETE FROM users WHERE email = 'dev.0033@example.com'"))


def test_outing_rules_are_seeded_from_hostel_practice(migrated_engine, test_db_url):
    # The per-test reset replaces the seeds, so rebuild the schema to read them fresh.
    cfg = alembic_config(test_db_url)
    command.downgrade(cfg, "0013")
    command.upgrade(cfg, "head")
    with migrated_engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT s.name, d.day_type, d.opens_at::text, d.return_by::text, "
                "d.max_minutes, d.needs_form, d.no_form_from::text "
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
    weekday = ["18:00:00", "20:00:00", None, False, None]
    assert rules[("Boys' hostels", "weekday")] == weekday
    assert rules[("Girls' hostels", "weekday")] == weekday
    # Saturday isn't a weekend day for now (0015).
    assert rules[("Boys' hostels", "saturday")] == weekday
    assert rules[("Girls' hostels", "saturday")] == weekday
    # Boys: a form outing in the day, or 6-8 PM without one (0015). Girls: the form only.
    assert rules[("Boys' hostels", "sunday")] == ["10:00:00", "20:00:00", 180, True, "18:00:00"]
    assert rules[("Boys' hostels", "holiday")] == ["10:00:00", "20:00:00", 180, True, "18:00:00"]
    assert rules[("Girls' hostels", "sunday")] == ["10:00:00", "20:00:00", 300, True, None]
    assert rules[("Girls' hostels", "holiday")] == ["10:00:00", "20:00:00", 300, True, None]
    assert len(rules) == 8
    assert default == "Boys' hostels"
