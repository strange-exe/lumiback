"""Kiosk health (when each gate's tablet last asked for a code), kiosk quiet hours, and the
indexes a student's record pages by

Quiet hours are off (both times null) until an admin sets them.

Revision ID: 0029
Revises: 0028
Create Date: 2026-11-08 10:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0029"
down_revision: str | Sequence[str] | None = "0028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("gates", sa.Column("kiosk_seen_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("campus_settings", sa.Column("kiosk_quiet_from", sa.Time(), nullable=True))
    op.add_column("campus_settings", sa.Column("kiosk_quiet_until", sa.Time(), nullable=True))
    op.create_check_constraint(
        op.f("ck_campus_settings_kiosk_quiet_pair"),
        "campus_settings",
        "(kiosk_quiet_from IS NULL) = (kiosk_quiet_until IS NULL) "
        "AND (kiosk_quiet_from IS NULL OR kiosk_quiet_from <> kiosk_quiet_until)",
    )
    op.create_index(
        op.f("ix_outing_requests_student_created"),
        "outing_requests",
        ["student_id", "created_at"],
    )
    op.create_index(op.f("ix_outing_corrections_outing_id"), "outing_corrections", ["outing_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_outing_corrections_outing_id"), table_name="outing_corrections")
    op.drop_index(op.f("ix_outing_requests_student_created"), table_name="outing_requests")
    op.drop_constraint(
        op.f("ck_campus_settings_kiosk_quiet_pair"), "campus_settings", type_="check"
    )
    op.drop_column("campus_settings", "kiosk_quiet_until")
    op.drop_column("campus_settings", "kiosk_quiet_from")
    op.drop_column("gates", "kiosk_seen_at")
