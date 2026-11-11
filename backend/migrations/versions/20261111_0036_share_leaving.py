"""When a share's tab said it was leaving (services/leaving.py).

A closing tab marks its share from `beforeunload`; the share ends after a short grace unless
the tab clears the mark (the student cancelled "Leave site?"). Nullable, no default: existing
shares have no mark.

Revision ID: 0036
Revises: 0035
Create Date: 2026-11-11 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0036"
down_revision: str | Sequence[str] | None = "0035"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "share_sessions", sa.Column("leaving_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("share_sessions", "leaving_at")
