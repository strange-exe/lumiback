"""Outing corrections: the office records or fixes a return, and students can ask for one

Revision ID: 0023
Revises: 0022
Create Date: 2026-11-06 21:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0023"
down_revision: str | Sequence[str] | None = "0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

IN_VIA = ("self", "gate", "staff", "unrecorded")


def _enum(name: str, *values: str) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False, create_constraint=True, length=16)


def upgrade() -> None:
    op.drop_constraint(op.f("ck_outings_outing_in_via"), "outings", type_="check")
    op.create_check_constraint(
        op.f("ck_outings_outing_in_via"),
        "outings",
        "in_via IN ('self', 'gate', 'staff', 'unrecorded')",
    )

    op.create_table(
        "outing_corrections",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("outing_id", sa.Uuid(), nullable=False),
        sa.Column(
            "kind", _enum("correction_kind", "return", "return_time", "cancel"), nullable=False
        ),
        sa.Column(
            "status",
            _enum("correction_status", "pending", "approved", "declined", "cancelled"),
            server_default="pending",
            nullable=False,
        ),
        sa.Column("returned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reason", sa.String(length=300), nullable=False),
        sa.Column("old_returned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("old_in_via", _enum("correction_old_in_via", *IN_VIA), nullable=True),
        sa.Column("asked_by", sa.Uuid(), nullable=True),
        sa.Column("by_staff", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("decided_by", sa.Uuid(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("note", sa.String(length=300), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "kind = 'cancel' OR returned_at IS NOT NULL",
            name=op.f("ck_outing_corrections_time_unless_cancel"),
        ),
        sa.ForeignKeyConstraint(
            ["outing_id"],
            ["outings.id"],
            name=op.f("fk_outing_corrections_outing_id_outings"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["asked_by"],
            ["users.id"],
            name=op.f("fk_outing_corrections_asked_by_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["decided_by"],
            ["users.id"],
            name=op.f("fk_outing_corrections_decided_by_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_outing_corrections")),
    )
    op.create_index(
        "uq_outing_corrections_one_pending",
        "outing_corrections",
        ["outing_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.create_index(
        "ix_outing_corrections_status_created", "outing_corrections", ["status", "created_at"]
    )
    op.execute("ALTER TABLE outing_corrections ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index("ix_outing_corrections_status_created", table_name="outing_corrections")
    op.drop_index("uq_outing_corrections_one_pending", table_name="outing_corrections")
    op.drop_table("outing_corrections")
    # Outings closed by the office keep their time; how is no longer recorded.
    op.execute("UPDATE outings SET in_via = NULL WHERE in_via IN ('staff', 'unrecorded')")
    op.drop_constraint(op.f("ck_outings_outing_in_via"), "outings", type_="check")
    op.create_check_constraint(
        op.f("ck_outings_outing_in_via"), "outings", "in_via IN ('self', 'gate')"
    )
