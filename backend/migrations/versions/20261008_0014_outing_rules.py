"""Outing rules: hostel rule sets, holidays, weekend requests, late follow-up and escalations

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-08 22:50:31.033625
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: str | Sequence[str] | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCAN_RESULTS = ("accepted", "bad_code", "gate_off", "too_far", "weak_gps", "mock_gps")


def upgrade() -> None:
    op.create_table(
        "holidays",
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.PrimaryKeyConstraint("day", name=op.f("pk_holidays")),
    )
    op.create_table(
        "rule_sets",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_rule_sets")),
        sa.UniqueConstraint("name", name=op.f("uq_rule_sets_name")),
    )
    op.create_table(
        "day_rules",
        sa.Column("rule_set_id", sa.Uuid(), nullable=False),
        sa.Column(
            "day_type",
            sa.Enum(
                "weekday",
                "saturday",
                "sunday",
                "holiday",
                name="day_type",
                native_enum=False,
                create_constraint=False,
                length=16,
            ),
            nullable=False,
        ),
        sa.Column("opens_at", sa.Time(), nullable=False),
        sa.Column("return_by", sa.Time(), nullable=False),
        sa.Column("late_until", sa.Time(), nullable=True),
        sa.Column("max_minutes", sa.Integer(), nullable=True),
        sa.Column("needs_form", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.CheckConstraint(
            "day_type IN ('weekday', 'saturday', 'sunday', 'holiday')",
            name=op.f("ck_day_rules_day_type"),
        ),
        sa.CheckConstraint(
            "late_until IS NULL OR late_until > return_by",
            name=op.f("ck_day_rules_late_after_return"),
        ),
        sa.CheckConstraint(
            "max_minutes IS NULL OR max_minutes BETWEEN 30 AND 720",
            name=op.f("ck_day_rules_max_range"),
        ),
        sa.CheckConstraint("return_by > opens_at", name=op.f("ck_day_rules_window_order")),
        sa.ForeignKeyConstraint(
            ["rule_set_id"],
            ["rule_sets.id"],
            name=op.f("fk_day_rules_rule_set_id_rule_sets"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("rule_set_id", "day_type", name=op.f("pk_day_rules")),
    )
    op.create_table(
        "hostels",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("rule_set_id", sa.Uuid(), nullable=False),
        sa.Column("warden_name", sa.String(length=80), nullable=True),
        sa.Column("warden_phone", sa.String(length=16), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["rule_set_id"],
            ["rule_sets.id"],
            name=op.f("fk_hostels_rule_set_id_rule_sets"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_hostels")),
        sa.UniqueConstraint("name", name=op.f("uq_hostels_name")),
    )
    op.create_table(
        "outing_requests",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("student_id", sa.Uuid(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("purpose", sa.String(length=200), nullable=False),
        sa.Column("phone", sa.String(length=16), nullable=False),
        sa.Column("emergency_name", sa.String(length=80), nullable=False),
        sa.Column("emergency_relation", sa.String(length=40), nullable=False),
        sa.Column("emergency_phone", sa.String(length=16), nullable=False),
        sa.Column("requested_minutes", sa.Integer(), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "pending",
                "approved",
                "declined",
                "cancelled",
                name="request_status",
                native_enum=False,
                create_constraint=False,
                length=16,
            ),
            server_default="pending",
            nullable=False,
        ),
        sa.Column("decided_by", sa.Uuid(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("note", sa.String(length=200), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'declined', 'cancelled')",
            name=op.f("ck_outing_requests_request_status"),
        ),
        sa.CheckConstraint(
            "requested_minutes IS NULL OR requested_minutes BETWEEN 30 AND 720",
            name=op.f("ck_outing_requests_requested_range"),
        ),
        sa.ForeignKeyConstraint(
            ["decided_by"],
            ["users.id"],
            name=op.f("fk_outing_requests_decided_by_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["student_id"],
            ["users.id"],
            name=op.f("fk_outing_requests_student_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_outing_requests")),
    )
    op.create_index(
        "ix_outing_requests_status_created",
        "outing_requests",
        ["status", "created_at"],
        unique=False,
    )
    op.create_index(
        "uq_outing_requests_one_live_per_day",
        "outing_requests",
        ["student_id", "day"],
        unique=True,
        postgresql_where=sa.text("status IN ('pending', 'approved')"),
    )
    op.create_table(
        "escalations",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("outing_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("resolved_by", sa.Uuid(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("note", sa.String(length=200), nullable=True),
        sa.ForeignKeyConstraint(
            ["outing_id"],
            ["outings.id"],
            name=op.f("fk_escalations_outing_id_outings"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["resolved_by"],
            ["users.id"],
            name=op.f("fk_escalations_resolved_by_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_escalations")),
        sa.UniqueConstraint("outing_id", name=op.f("uq_escalations_outing_id")),
    )
    op.add_column("campus_settings", sa.Column("default_rule_set_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f("fk_campus_settings_default_rule_set_id_rule_sets"),
        "campus_settings",
        "rule_sets",
        ["default_rule_set_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column("outings", sa.Column("request_id", sa.Uuid(), nullable=True))
    op.add_column("outings", sa.Column("late_reason", sa.String(length=200), nullable=True))
    op.add_column("outings", sa.Column("late_alert_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "outings",
        sa.Column(
            "late_reply",
            sa.Enum(
                "on_my_way",
                "safe",
                name="late_reply",
                native_enum=False,
                create_constraint=False,
                length=16,
            ),
            nullable=True,
        ),
    )
    op.create_check_constraint(
        op.f("ck_outings_late_reply"), "outings", "late_reply IN ('on_my_way', 'safe')"
    )
    op.add_column(
        "outings", sa.Column("late_replied_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_foreign_key(
        op.f("fk_outings_request_id_outing_requests"),
        "outings",
        "outing_requests",
        ["request_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column("users", sa.Column("hostel_id", sa.Uuid(), nullable=True))
    op.add_column("users", sa.Column("phone", sa.String(length=16), nullable=True))
    op.add_column("users", sa.Column("emergency_name", sa.String(length=80), nullable=True))
    op.add_column("users", sa.Column("emergency_relation", sa.String(length=40), nullable=True))
    op.add_column("users", sa.Column("emergency_phone", sa.String(length=16), nullable=True))
    op.create_foreign_key(
        op.f("fk_users_hostel_id_hostels"),
        "users",
        "hostels",
        ["hostel_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # Gate scans can now be refused by the rules (at the gate, but outside the allowed hours).
    op.drop_constraint(op.f("ck_gate_scans_scan_result"), "gate_scans", type_="check")
    op.create_check_constraint(
        op.f("ck_gate_scans_scan_result"),
        "gate_scans",
        f"result IN ({', '.join(repr(r) for r in SCAN_RESULTS)}, 'not_allowed')",
    )

    for table in (
        "holidays",
        "rule_sets",
        "day_rules",
        "hostels",
        "outing_requests",
        "escalations",
    ):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")

    # Starting rules from the hostels' current practice (admins can change every value):
    # weekdays 6-8 PM, with an 8:30 PM option (and a reason) for boys' hostels only; weekends
    # and holidays 10 AM - 8 PM with an approved form, at most 3 h (boys) or 5 h (girls).
    op.execute(
        """
        WITH sets AS (
            INSERT INTO rule_sets (name) VALUES ('Boys'' hostels'), ('Girls'' hostels')
            RETURNING id, name
        )
        INSERT INTO day_rules
            (rule_set_id, day_type, opens_at, return_by, late_until, max_minutes, needs_form)
        SELECT s.id, d.day_type, d.opens_at::time, d.return_by::time,
               CASE WHEN s.name = 'Boys'' hostels' THEN d.late_until::time END,
               CASE WHEN d.day_type = 'weekday' THEN NULL
                    WHEN s.name = 'Boys'' hostels' THEN 180 ELSE 300 END,
               d.day_type <> 'weekday'
        FROM sets s CROSS JOIN (VALUES
            ('weekday', '18:00', '20:00', '20:30'),
            ('saturday', '10:00', '20:00', NULL),
            ('sunday', '10:00', '20:00', NULL),
            ('holiday', '10:00', '20:00', NULL)
        ) AS d(day_type, opens_at, return_by, late_until)
        """
    )
    # Until students pick a hostel: the stricter weekend limit, and the 8:30 PM option.
    op.execute(
        "UPDATE campus_settings SET default_rule_set_id = "
        "(SELECT id FROM rule_sets WHERE name = 'Boys'' hostels')"
    )


def downgrade() -> None:
    op.execute("DELETE FROM gate_scans WHERE result = 'not_allowed'")
    op.drop_constraint(op.f("ck_gate_scans_scan_result"), "gate_scans", type_="check")
    op.create_check_constraint(
        op.f("ck_gate_scans_scan_result"),
        "gate_scans",
        f"result IN ({', '.join(repr(r) for r in SCAN_RESULTS)})",
    )
    op.drop_constraint(op.f("fk_users_hostel_id_hostels"), "users", type_="foreignkey")
    op.drop_column("users", "emergency_phone")
    op.drop_column("users", "emergency_relation")
    op.drop_column("users", "emergency_name")
    op.drop_column("users", "phone")
    op.drop_column("users", "hostel_id")
    op.drop_constraint(op.f("fk_outings_request_id_outing_requests"), "outings", type_="foreignkey")
    op.drop_column("outings", "late_replied_at")
    op.drop_constraint(op.f("ck_outings_late_reply"), "outings", type_="check")
    op.drop_column("outings", "late_reply")
    op.drop_column("outings", "late_alert_at")
    op.drop_column("outings", "late_reason")
    op.drop_column("outings", "request_id")
    op.drop_constraint(
        op.f("fk_campus_settings_default_rule_set_id_rule_sets"),
        "campus_settings",
        type_="foreignkey",
    )
    op.drop_column("campus_settings", "default_rule_set_id")
    op.drop_table("escalations")
    op.drop_index(
        "uq_outing_requests_one_live_per_day",
        table_name="outing_requests",
        postgresql_where=sa.text("status IN ('pending', 'approved')"),
    )
    op.drop_index("ix_outing_requests_status_created", table_name="outing_requests")
    op.drop_table("outing_requests")
    op.drop_table("hostels")
    op.drop_table("day_rules")
    op.drop_table("rule_sets")
    op.drop_table("holidays")
