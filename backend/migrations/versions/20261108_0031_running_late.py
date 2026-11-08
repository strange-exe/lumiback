"""Running late (wave 3, owner 2026-11-08: "Yes, within a cap"): a student who is out tells the
hostel office they'll be 15, 30 or 60 minutes late, once per outing. The due time moves; the
time before it, how much and why are kept with the outing.

The cap is the database's too: one move of 15, 30 or 60 minutes, and the due time is exactly the
original plus that move.

Revision ID: 0031
Revises: 0030
Create Date: 2026-11-08 22:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0031"
down_revision: str | Sequence[str] | None = "0030"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COLUMNS = (
    sa.Column("original_return_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("running_late_minutes", sa.Integer(), nullable=True),
    sa.Column("running_late_reason", sa.String(length=120), nullable=True),
    sa.Column("running_late_at", sa.DateTime(timezone=True), nullable=True),
)


def upgrade() -> None:
    for column in COLUMNS:
        op.add_column("outings", column)
    op.create_check_constraint(
        op.f("ck_outings_running_late_once_within_cap"),
        "outings",
        "(running_late_minutes IS NULL AND running_late_at IS NULL "
        "AND original_return_at IS NULL AND running_late_reason IS NULL) "
        "OR (running_late_minutes IN (15, 30, 60) AND running_late_at IS NOT NULL "
        "AND original_return_at IS NOT NULL "
        "AND expected_return_at = original_return_at "
        "+ running_late_minutes * interval '1 minute')",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_outings_running_late_once_within_cap"), "outings", type_="check")
    for column in reversed(COLUMNS):
        op.drop_column("outings", column.name)
