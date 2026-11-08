"""Alerts (wave 2): the alert outbox, escalation follow-up (claim, call log, re-alerts, hand
over to the head wardens), request reminders, help requests, and the follow-up timings

Timings default to the owner's choices (2026-11-07): remind after 15 min, head wardens may
decide after 30; re-alert every 15 min while unclaimed, hand over after 30.

Revision ID: 0030
Revises: 0029
Create Date: 2026-11-08 18:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0030"
down_revision: str | Sequence[str] | None = "0029"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TIMINGS = (
    ("request_remind_minutes", "15"),
    ("request_backup_minutes", "30"),
    ("escalation_realert_minutes", "15"),
    ("escalation_takeover_minutes", "30"),
)


def _enum(name: str, *values: str) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False, create_constraint=True, length=16)


def _created_at(name: str = "created_at") -> sa.Column:
    return sa.Column(
        name, sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
    )


def upgrade() -> None:
    for column, default in TIMINGS:
        op.add_column(
            "campus_settings",
            sa.Column(column, sa.Integer(), server_default=sa.text(default), nullable=False),
        )
    op.create_check_constraint(
        op.f("ck_campus_settings_alert_timings_range"),
        "campus_settings",
        "request_remind_minutes BETWEEN 5 AND 240 AND request_backup_minutes BETWEEN 5 AND 240 "
        "AND escalation_realert_minutes BETWEEN 5 AND 240 "
        "AND escalation_takeover_minutes BETWEEN 5 AND 240",
    )

    op.add_column(
        "outing_requests", sa.Column("reminded_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "outing_requests",
        sa.Column("backup_notified_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.add_column("escalations", sa.Column("claimed_by", sa.Uuid(), nullable=True))
    op.add_column("escalations", sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "escalations", sa.Column("realerted_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "escalations",
        sa.Column("realerts", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    op.add_column(
        "escalations", sa.Column("handed_over_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_foreign_key(
        op.f("fk_escalations_claimed_by_users"),
        "escalations",
        "users",
        ["claimed_by"],
        ["id"],
        ondelete="SET NULL",
    )
    # Escalations already open: their follow-up starts from now, so the first sweep doesn't
    # re-alert every one of them at once, nor hand the ones past 30 min to the head wardens in
    # one burst (they were already told when each opened). Not undone by the downgrade, which
    # drops the columns.
    op.execute("UPDATE escalations SET realerted_at = now() WHERE resolved_at IS NULL")
    op.execute(
        "UPDATE escalations SET handed_over_at = now() "
        "WHERE resolved_at IS NULL AND created_at <= now() - interval '30 minutes'"
    )
    # Staff live in no hostel (owner, 2026-11-08: promotion clears it; a warden's hostels are
    # warden_hostels): staff promoted earlier leave their old hostel's lists too. One-way: the
    # downgrade can't know which hostel each had.
    op.execute(
        "UPDATE users SET hostel_id = NULL WHERE role <> 'student' AND hostel_id IS NOT NULL"
    )

    op.create_table(
        "escalation_calls",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("escalation_id", sa.Uuid(), nullable=False),
        sa.Column("by_id", sa.Uuid(), nullable=True),
        sa.Column(
            "outcome",
            _enum(
                "call_outcome", "reached_student", "reached_contact", "no_answer", "left_message"
            ),
            nullable=False,
        ),
        sa.Column("note", sa.String(length=200), nullable=True),
        _created_at("at"),
        sa.ForeignKeyConstraint(
            ["escalation_id"],
            ["escalations.id"],
            name=op.f("fk_escalation_calls_escalation_id_escalations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["by_id"],
            ["users.id"],
            name=op.f("fk_escalation_calls_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_escalation_calls")),
    )
    op.create_index(
        op.f("ix_escalation_calls_escalation_id"), "escalation_calls", ["escalation_id"]
    )
    op.execute("ALTER TABLE escalation_calls ENABLE ROW LEVEL SECURITY")

    op.create_table(
        "help_requests",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("student_id", sa.Uuid(), nullable=False),
        sa.Column("outing_id", sa.Uuid(), nullable=True),
        sa.Column("hostel_id", sa.Uuid(), nullable=True),
        sa.Column("lat", sa.Float(), nullable=True),
        sa.Column("lng", sa.Float(), nullable=True),
        sa.Column("accuracy_m", sa.Float(), nullable=True),
        sa.Column("mocked", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        _created_at(),
        sa.Column("handled_by", sa.Uuid(), nullable=True),
        sa.Column("handled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("note", sa.String(length=200), nullable=True),
        sa.CheckConstraint("lat BETWEEN -90 AND 90", name=op.f("ck_help_requests_lat_range")),
        sa.CheckConstraint("lng BETWEEN -180 AND 180", name=op.f("ck_help_requests_lng_range")),
        sa.CheckConstraint("accuracy_m >= 0", name=op.f("ck_help_requests_accuracy_non_negative")),
        sa.CheckConstraint(
            "(lat IS NULL) = (lng IS NULL) AND (lat IS NULL) = (accuracy_m IS NULL)",
            name=op.f("ck_help_requests_fix_complete"),
        ),
        sa.ForeignKeyConstraint(
            ["student_id"],
            ["users.id"],
            name=op.f("fk_help_requests_student_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["outing_id"],
            ["outings.id"],
            name=op.f("fk_help_requests_outing_id_outings"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["hostel_id"],
            ["hostels.id"],
            name=op.f("fk_help_requests_hostel_id_hostels"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["handled_by"],
            ["users.id"],
            name=op.f("fk_help_requests_handled_by_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_help_requests")),
    )
    op.create_index(op.f("ix_help_requests_student_id"), "help_requests", ["student_id"])
    op.create_index(op.f("ix_help_requests_outing_id"), "help_requests", ["outing_id"])
    op.create_index(
        op.f("ix_help_requests_hostel_created"), "help_requests", ["hostel_id", "created_at"]
    )
    op.create_index(op.f("ix_help_requests_created_at"), "help_requests", ["created_at"])
    op.execute("ALTER TABLE help_requests ENABLE ROW LEVEL SECURITY")

    op.create_table(
        "alert_outbox",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("key", sa.String(length=200), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("mode", _enum("outbox_mode", "push", "email", "push_or_email"), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column(
            "payload",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
        _created_at("next_attempt_at"),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(length=200), nullable=True),
        _created_at(),
        sa.CheckConstraint(
            "user_id IS NOT NULL OR mode = 'email'", name=op.f("ck_alert_outbox_push_has_user")
        ),
        sa.CheckConstraint("attempts >= 0", name=op.f("ck_alert_outbox_attempts_non_negative")),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_alert_outbox_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_alert_outbox")),
        sa.UniqueConstraint("key", name=op.f("uq_alert_outbox_key")),
    )
    op.create_index(op.f("ix_alert_outbox_user_id"), "alert_outbox", ["user_id"])
    op.create_index(
        op.f("ix_alert_outbox_due"),
        "alert_outbox",
        ["next_attempt_at"],
        postgresql_where=sa.text("sent_at IS NULL AND failed_at IS NULL"),
    )
    op.create_index(op.f("ix_alert_outbox_created_at"), "alert_outbox", ["created_at"])
    op.execute("ALTER TABLE alert_outbox ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("alert_outbox")
    op.drop_table("help_requests")
    op.drop_table("escalation_calls")
    op.drop_constraint(op.f("fk_escalations_claimed_by_users"), "escalations", type_="foreignkey")
    for column in ("handed_over_at", "realerts", "realerted_at", "claimed_at", "claimed_by"):
        op.drop_column("escalations", column)
    op.drop_column("outing_requests", "backup_notified_at")
    op.drop_column("outing_requests", "reminded_at")
    op.drop_constraint(
        op.f("ck_campus_settings_alert_timings_range"), "campus_settings", type_="check"
    )
    for column, _ in reversed(TIMINGS):
        op.drop_column("campus_settings", column)
