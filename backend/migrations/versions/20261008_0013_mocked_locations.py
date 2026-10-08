"""Live locations keep the latest real fix and the latest mock-location fix side by side

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-08 21:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: str | Sequence[str] | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "locations",
        sa.Column("mocked", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.drop_constraint(op.f("pk_locations"), "locations", type_="primary")
    op.create_primary_key(op.f("pk_locations"), "locations", ["session_id", "mocked"])


def downgrade() -> None:
    # Mock fixes are live-only data (deleted when a share ends); drop them rather than merge.
    op.execute("DELETE FROM locations WHERE mocked")
    op.drop_constraint(op.f("pk_locations"), "locations", type_="primary")
    op.create_primary_key(op.f("pk_locations"), "locations", ["session_id"])
    op.drop_column("locations", "mocked")
