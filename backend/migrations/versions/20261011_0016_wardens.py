"""Warden role, scoped to the hostels an admin assigns

Revision ID: 0016
Revises: 0015
Create Date: 2026-10-11 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: str | Sequence[str] | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint(op.f("ck_users_user_role"), "users", type_="check")
    op.create_check_constraint(
        op.f("ck_users_user_role"), "users", "role IN ('student', 'warden', 'admin')"
    )
    op.create_table(
        "warden_hostels",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("hostel_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_warden_hostels_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["hostel_id"],
            ["hostels.id"],
            name=op.f("fk_warden_hostels_hostel_id_hostels"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", "hostel_id", name=op.f("pk_warden_hostels")),
    )
    op.create_index(op.f("ix_warden_hostels_hostel_id"), "warden_hostels", ["hostel_id"])
    op.execute("ALTER TABLE warden_hostels ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index(op.f("ix_warden_hostels_hostel_id"), table_name="warden_hostels")
    op.drop_table("warden_hostels")
    # Wardens become students again: the old constraint has no warden role.
    op.execute("UPDATE users SET role = 'student' WHERE role = 'warden'")
    op.drop_constraint(op.f("ck_users_user_role"), "users", type_="check")
    op.create_check_constraint(op.f("ck_users_user_role"), "users", "role IN ('student', 'admin')")
