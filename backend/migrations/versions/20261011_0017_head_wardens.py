"""Head warden role: every hostel's students, and the outing rules

Revision ID: 0017
Revises: 0016
Create Date: 2026-10-11 18:00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0017"
down_revision: str | Sequence[str] | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint(op.f("ck_users_user_role"), "users", type_="check")
    op.create_check_constraint(
        op.f("ck_users_user_role"),
        "users",
        "role IN ('student', 'warden', 'head_warden', 'admin')",
    )


def downgrade() -> None:
    # Head wardens become wardens with no hostels: they keep a role, but see no students
    # until an admin assigns hostels.
    op.execute("UPDATE users SET role = 'warden' WHERE role = 'head_warden'")
    op.drop_constraint(op.f("ck_users_user_role"), "users", type_="check")
    op.create_check_constraint(
        op.f("ck_users_user_role"), "users", "role IN ('student', 'warden', 'admin')"
    )
