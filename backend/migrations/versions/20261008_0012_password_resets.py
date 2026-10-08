"""Password reset codes

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-08 20:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: str | Sequence[str] | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "password_resets",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("code_hash", sa.LargeBinary(), nullable=False),
        sa.Column("attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "octet_length(code_hash) = 32", name=op.f("ck_password_resets_code_hash_len")
        ),
        sa.CheckConstraint("attempts >= 0", name=op.f("ck_password_resets_attempts_non_negative")),
        sa.CheckConstraint(
            "expires_at > created_at", name=op.f("ck_password_resets_expires_after_create")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_password_resets_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_password_resets")),
    )
    # Every table denies Supabase's Data API (see 0002).
    op.execute("ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("password_resets")
