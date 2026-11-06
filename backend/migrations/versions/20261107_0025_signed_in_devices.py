"""Signed-in devices: each sign-in's device label and start, and push tokens tied to it

Revision ID: 0025
Revises: 0024
Create Date: 2026-11-07 21:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0025"
down_revision: str | Sequence[str] | None = "0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("refresh_tokens", sa.Column("device", sa.String(length=80), nullable=True))
    op.add_column(
        "refresh_tokens", sa.Column("signed_in_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("push_tokens", sa.Column("family_id", sa.Uuid(), nullable=True))
    op.create_index(op.f("ix_push_tokens_family_id"), "push_tokens", ["family_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_push_tokens_family_id"), table_name="push_tokens")
    op.drop_column("push_tokens", "family_id")
    op.drop_column("refresh_tokens", "signed_in_at")
    op.drop_column("refresh_tokens", "device")
