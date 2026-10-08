"""Push tokens remember which notification channels the student muted

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-08 18:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0011"
down_revision: str | Sequence[str] | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "push_tokens",
        sa.Column(
            "muted",
            postgresql.ARRAY(sa.String(length=32)),
            server_default=sa.text("'{}'"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("push_tokens", "muted")
