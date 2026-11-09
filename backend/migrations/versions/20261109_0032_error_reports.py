"""Error reports (wave 4): what broke on the website or in the app, scrubbed, one row per group
of the same error, kept 30 days after it was last seen (jobs/expiry.py).

Revision ID: 0032
Revises: 0031
Create Date: 2026-11-09 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0032"
down_revision: str | Sequence[str] | None = "0031"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "error_reports",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("fingerprint", sa.LargeBinary(), nullable=False),
        sa.Column("message", sa.String(length=500), nullable=False),
        sa.Column("top_frame", sa.String(length=500), nullable=True),
        sa.Column("stack", sa.Text(), nullable=True),
        sa.Column("route", sa.String(length=300), nullable=True),
        sa.Column("platform", sa.String(length=16), nullable=False),
        sa.Column("app_version", sa.String(length=32), nullable=True),
        sa.Column("count", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("last_user_id", sa.Uuid(), nullable=True),
        sa.Column(
            "first_seen_at",
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
        sa.CheckConstraint(
            "octet_length(fingerprint) = 32", name=op.f("ck_error_reports_fingerprint_len")
        ),
        sa.CheckConstraint("count >= 1", name=op.f("ck_error_reports_count_positive")),
        sa.ForeignKeyConstraint(
            ["last_user_id"],
            ["users.id"],
            name=op.f("fk_error_reports_last_user_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_error_reports")),
        sa.UniqueConstraint("fingerprint", name=op.f("uq_error_reports_fingerprint")),
    )
    op.create_index(op.f("ix_error_reports_last_seen_at"), "error_reports", ["last_seen_at"])
    op.create_index(op.f("ix_error_reports_last_user_id"), "error_reports", ["last_user_id"])
    op.execute("ALTER TABLE error_reports ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("error_reports")
