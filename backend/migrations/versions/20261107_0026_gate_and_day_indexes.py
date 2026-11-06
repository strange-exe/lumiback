"""Indexes for which gates are in use, and for the campus-wide register by day

Revision ID: 0026
Revises: 0025
Create Date: 2026-11-07 23:00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0026"
down_revision: str | Sequence[str] | None = "0025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

INDEXES = [
    ("ix_outings_left_at", "outings", ["left_at"]),
    ("ix_outings_out_gate_id", "outings", ["out_gate_id"]),
    ("ix_outings_in_gate_id", "outings", ["in_gate_id"]),
    ("ix_gate_scans_gate_id", "gate_scans", ["gate_id"]),
]


def upgrade() -> None:
    for name, table, columns in INDEXES:
        op.create_index(name, table, columns)


def downgrade() -> None:
    for name, table, _ in reversed(INDEXES):
        op.drop_index(name, table_name=table)
