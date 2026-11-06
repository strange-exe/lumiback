"""Mark the safe-return emergency contact's viewer row, so the student can tell it apart

Revision ID: 0021
Revises: 0020
Create Date: 2026-11-06 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0021"
down_revision: str | Sequence[str] | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "share_viewers",
        sa.Column("is_contact", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("share_viewers", "is_contact")
