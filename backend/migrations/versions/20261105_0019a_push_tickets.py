"""Push tickets waiting for Expo's delivery receipt

Revision ID: 0019a
Revises: 0018
Create Date: 2026-11-05 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019a"
down_revision: str | Sequence[str] | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "push_tickets",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("token", sa.String(length=255), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_push_tickets")),
    )
    op.create_index(op.f("ix_push_tickets_created_at"), "push_tickets", ["created_at"])
    op.execute("ALTER TABLE push_tickets ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index(op.f("ix_push_tickets_created_at"), table_name="push_tickets")
    op.drop_table("push_tickets")
