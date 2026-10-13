"""Outings remember the student's hostel at the time; indexes for the sweep and the requests queue

Revision ID: 0018
Revises: 0017
Create Date: 2026-10-13 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0018"
down_revision: str | Sequence[str] | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("outings", sa.Column("hostel_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f("fk_outings_hostel_id_hostels"),
        "outings",
        "hostels",
        ["hostel_id"],
        ["id"],
        ondelete="SET NULL",
    )
    # Past outings: the best record there is of where the student lived is where they live now.
    op.execute(
        "UPDATE outings SET hostel_id = users.hostel_id "
        "FROM users WHERE users.id = outings.student_id"
    )
    op.create_index("ix_outings_hostel_left", "outings", ["hostel_id", "left_at"])
    op.create_index("ix_outings_request_id", "outings", ["request_id"])
    op.create_index("ix_outing_requests_day", "outing_requests", ["day"])
    op.create_index("ix_access_log_viewed_at", "access_log", ["viewed_at"])


def downgrade() -> None:
    op.drop_index("ix_access_log_viewed_at", table_name="access_log")
    op.drop_index("ix_outing_requests_day", table_name="outing_requests")
    op.drop_index("ix_outings_request_id", table_name="outings")
    op.drop_index("ix_outings_hostel_left", table_name="outings")
    op.drop_constraint(op.f("fk_outings_hostel_id_hostels"), "outings", type_="foreignkey")
    op.drop_column("outings", "hostel_id")
