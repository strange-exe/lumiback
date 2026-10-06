"""share_sessions.sharer_seen_at: when the sharer's device last reported in

Tab-live sessions end when the tab goes quiet (closed, crashed, phone locked), so the sweep needs
the server's own record of the last check-in, not the device clock in recorded_at.

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-06 18:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | Sequence[str] | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "share_sessions",
        sa.Column("sharer_seen_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("share_sessions", "sharer_seen_at")
