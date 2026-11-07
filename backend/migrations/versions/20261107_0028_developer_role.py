"""Developer role: every admin power, plus a read-only "view as" another account

Granted only by scripts/make_developer.py, never from the dashboard.

Revision ID: 0028
Revises: 0027
Create Date: 2026-11-07 23:59:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0028"
down_revision: str | Sequence[str] | None = "0027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint(op.f("ck_users_user_role"), "users", type_="check")
    op.create_check_constraint(
        op.f("ck_users_user_role"),
        "users",
        "role IN ('student', 'warden', 'head_warden', 'admin', 'developer')",
    )


def downgrade() -> None:
    # Developers become admins: they keep every power the old schema knows (only "view as"
    # goes), and nobody who ran the campus is locked out by a rollback.
    op.execute("UPDATE users SET role = 'admin' WHERE role = 'developer'")
    op.drop_constraint(op.f("ck_users_user_role"), "users", type_="check")
    op.create_check_constraint(
        op.f("ck_users_user_role"),
        "users",
        "role IN ('student', 'warden', 'head_warden', 'admin')",
    )
