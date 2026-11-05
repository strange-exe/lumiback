"""Safe return: an optional emergency contact email, and the outing-linked share it follows

Revision ID: 0020
Revises: 0019
Create Date: 2026-11-05 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020"
down_revision: str | Sequence[str] | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("emergency_email", sa.String(length=254), nullable=True))
    op.create_check_constraint(
        op.f("ck_users_emergency_email_lowercase"),
        "users",
        "emergency_email = lower(emergency_email)",
    )
    op.add_column("outings", sa.Column("safe_return_session_id", sa.Uuid(), nullable=True))
    op.add_column("outings", sa.Column("safe_return_email", sa.String(length=254), nullable=True))
    op.create_foreign_key(
        op.f("fk_outings_safe_return_session_id_share_sessions"),
        "outings",
        "share_sessions",
        ["safe_return_session_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("fk_outings_safe_return_session_id_share_sessions"), "outings", type_="foreignkey"
    )
    op.drop_column("outings", "safe_return_email")
    op.drop_column("outings", "safe_return_session_id")
    op.drop_constraint(op.f("ck_users_emergency_email_lowercase"), "users", type_="check")
    op.drop_column("users", "emergency_email")
