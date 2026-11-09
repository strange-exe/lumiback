"""Phones whose app draws the update announcement itself (its background task) get it as a
data-only push, so the notice keeps its Changelog and Update buttons with the app closed. Every
phone registered so far runs an app without that task: false until it registers again.

Revision ID: 0034
Revises: 0033
Create Date: 2026-11-09 21:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0034"
down_revision: str | Sequence[str] | None = "0033"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "push_tokens",
        sa.Column("draws_updates", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("push_tokens", "draws_updates")
