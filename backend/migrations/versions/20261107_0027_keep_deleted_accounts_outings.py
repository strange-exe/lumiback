"""A deleted account's outings stay with the hostel's record, detached with a snapshot

Deleting an account used to cascade to its outings (and their escalations and corrections),
which erased them from the hostel office's register. Now they are detached instead: the
student's id goes, the name and roll no. at the time stay, and the sweep purges them once the
campus retention period has passed since the deletion. A request an outing used stays with it.

Revision ID: 0027
Revises: 0026
Create Date: 2026-11-07 23:30:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0027"
down_revision: str | Sequence[str] | None = "0026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

STUDENT_FKS = [
    ("outings", "fk_outings_student_id_users"),
    ("outing_requests", "fk_outing_requests_student_id_users"),
]


def _student_fk(table: str, name: str, ondelete: str) -> None:
    op.drop_constraint(op.f(name), table, type_="foreignkey")
    op.create_foreign_key(op.f(name), table, "users", ["student_id"], ["id"], ondelete=ondelete)


def upgrade() -> None:
    op.add_column("outings", sa.Column("student_name", sa.String(length=100), nullable=True))
    op.add_column("outings", sa.Column("student_roll_no", sa.String(length=32), nullable=True))
    op.add_column("outings", sa.Column("detached_at", sa.DateTime(timezone=True), nullable=True))
    for table, name in STUDENT_FKS:
        op.alter_column(table, "student_id", existing_type=sa.Uuid(), nullable=True)
        _student_fk(table, name, "SET NULL")
    op.create_check_constraint(
        op.f("ck_outings_owned_or_detached"),
        "outings",
        "student_id IS NOT NULL OR (detached_at IS NOT NULL AND student_name IS NOT NULL)",
    )
    op.create_index(
        "ix_outings_detached_at",
        "outings",
        ["detached_at"],
        postgresql_where=sa.text("detached_at IS NOT NULL"),
    )


def downgrade() -> None:
    # Detached rows have no account to belong to under the old schema: they go, as the cascade
    # would have removed them at deletion.
    op.execute("DELETE FROM outing_requests WHERE student_id IS NULL")
    op.execute("DELETE FROM outings WHERE student_id IS NULL")
    op.drop_index("ix_outings_detached_at", table_name="outings")
    op.drop_constraint(op.f("ck_outings_owned_or_detached"), "outings", type_="check")
    for table, name in reversed(STUDENT_FKS):
        _student_fk(table, name, "CASCADE")
        op.alter_column(table, "student_id", existing_type=sa.Uuid(), nullable=False)
    op.drop_column("outings", "detached_at")
    op.drop_column("outings", "student_roll_no")
    op.drop_column("outings", "student_name")
