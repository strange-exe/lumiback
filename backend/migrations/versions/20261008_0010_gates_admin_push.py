"""Gates and gate scans, admin role, campus settings, push tokens, admin audit

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-08 10:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | Sequence[str] | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def enum(name: str, *values: str) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False, create_constraint=False, length=16)


def upgrade() -> None:
    # Roles: everyone is a student until an admin promotes them.
    op.add_column(
        "users",
        sa.Column(
            "role", enum("user_role", "student", "admin"), server_default="student", nullable=False
        ),
    )
    op.create_check_constraint(op.f("ck_users_user_role"), "users", "role IN ('student', 'admin')")

    op.create_table(
        "gates",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lng", sa.Float(), nullable=False),
        sa.Column("radius_m", sa.Integer(), server_default=sa.text("75"), nullable=False),
        sa.Column("kiosk_token_hash", sa.LargeBinary(), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "octet_length(kiosk_token_hash) = 32", name=op.f("ck_gates_kiosk_token_hash_len")
        ),
        sa.CheckConstraint("radius_m BETWEEN 10 AND 500", name=op.f("ck_gates_radius_range")),
        sa.CheckConstraint(
            "lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180",
            name=op.f("ck_gates_coordinates"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_gates")),
        sa.UniqueConstraint("name", name=op.f("uq_gates_name")),
        sa.UniqueConstraint("kiosk_token_hash", name=op.f("uq_gates_kiosk_token_hash")),
    )

    # Outings remember whether they were opened / closed at a gate or in the app.
    op.add_column(
        "outings",
        sa.Column(
            "out_via", enum("outing_via", "self", "gate"), server_default="self", nullable=False
        ),
    )
    op.add_column(
        "outings", sa.Column("in_via", enum("outing_in_via", "self", "gate"), nullable=True)
    )
    op.create_check_constraint(
        op.f("ck_outings_outing_via"), "outings", "out_via IN ('self', 'gate')"
    )
    op.create_check_constraint(
        op.f("ck_outings_outing_in_via"), "outings", "in_via IN ('self', 'gate')"
    )
    op.add_column("outings", sa.Column("out_gate_id", sa.Uuid(), nullable=True))
    op.add_column("outings", sa.Column("in_gate_id", sa.Uuid(), nullable=True))
    op.add_column(
        "outings", sa.Column("overdue_notified_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_foreign_key(
        op.f("fk_outings_out_gate_id_gates"),
        "outings",
        "gates",
        ["out_gate_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        op.f("fk_outings_in_gate_id_gates"),
        "outings",
        "gates",
        ["in_gate_id"],
        ["id"],
        ondelete="SET NULL",
    )
    # Existing returned outings were all closed in the app.
    op.execute("UPDATE outings SET in_via = 'self' WHERE returned_at IS NOT NULL")

    op.create_table(
        "campus_settings",
        sa.Column("id", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("curfew", sa.Time(), server_default=sa.text("'21:30'"), nullable=False),
        sa.Column(
            "scan_retention_days", sa.Integer(), server_default=sa.text("180"), nullable=False
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("id = 1", name=op.f("ck_campus_settings_single_row")),
        sa.CheckConstraint(
            "scan_retention_days BETWEEN 7 AND 730", name=op.f("ck_campus_settings_retention_range")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_campus_settings")),
    )
    op.execute("INSERT INTO campus_settings (id) VALUES (1)")

    op.create_table(
        "gate_scans",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("gate_id", sa.Uuid(), nullable=True),
        sa.Column("direction", enum("scan_direction", "out", "in"), nullable=False),
        sa.Column(
            "result",
            enum(
                "scan_result", "accepted", "bad_code", "gate_off", "too_far", "weak_gps", "mock_gps"
            ),
            nullable=False,
        ),
        sa.Column("distance_m", sa.Float(), nullable=True),
        sa.Column("accuracy_m", sa.Float(), nullable=True),
        sa.Column("outing_id", sa.Uuid(), nullable=True),
        sa.Column(
            "scanned_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("direction IN ('out', 'in')", name=op.f("ck_gate_scans_scan_direction")),
        sa.CheckConstraint(
            "result IN ('accepted', 'bad_code', 'gate_off', 'too_far', 'weak_gps', 'mock_gps')",
            name=op.f("ck_gate_scans_scan_result"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_gate_scans_user_id_users"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["gate_id"], ["gates.id"], name=op.f("fk_gate_scans_gate_id_gates"), ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["outing_id"],
            ["outings.id"],
            name=op.f("fk_gate_scans_outing_id_outings"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_gate_scans")),
    )
    op.create_index("ix_gate_scans_scanned", "gate_scans", ["scanned_at"])
    op.create_index("ix_gate_scans_user_scanned", "gate_scans", ["user_id", "scanned_at"])

    op.create_table(
        "push_tokens",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token", sa.String(255), nullable=False),
        sa.Column("platform", sa.String(16), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_push_tokens_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_push_tokens")),
        sa.UniqueConstraint("token", name=op.f("uq_push_tokens_token")),
    )
    op.create_index(op.f("ix_push_tokens_user_id"), "push_tokens", ["user_id"])

    op.create_table(
        "admin_audit",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("action", sa.String(40), nullable=False),
        sa.Column("target", sa.String(160), nullable=False),
        sa.Column(
            "at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["actor_id"],
            ["users.id"],
            name=op.f("fk_admin_audit_actor_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_admin_audit")),
    )

    for table in ("gates", "campus_settings", "gate_scans", "push_tokens", "admin_audit"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("admin_audit")
    op.drop_index(op.f("ix_push_tokens_user_id"), table_name="push_tokens")
    op.drop_table("push_tokens")
    op.drop_index("ix_gate_scans_user_scanned", table_name="gate_scans")
    op.drop_index("ix_gate_scans_scanned", table_name="gate_scans")
    op.drop_table("gate_scans")
    op.drop_table("campus_settings")
    op.drop_constraint(op.f("fk_outings_in_gate_id_gates"), "outings", type_="foreignkey")
    op.drop_constraint(op.f("fk_outings_out_gate_id_gates"), "outings", type_="foreignkey")
    op.drop_constraint(op.f("ck_outings_outing_in_via"), "outings", type_="check")
    op.drop_constraint(op.f("ck_outings_outing_via"), "outings", type_="check")
    for column in ("overdue_notified_at", "in_gate_id", "out_gate_id", "in_via", "out_via"):
        op.drop_column("outings", column)
    op.drop_table("gates")
    op.drop_constraint(op.f("ck_users_user_role"), "users", type_="check")
    op.drop_column("users", "role")
