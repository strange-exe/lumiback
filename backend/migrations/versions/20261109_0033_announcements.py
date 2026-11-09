"""Announcements v2 (wave 5): each update announcement a developer sends, with its kind,
audience and phone count, for the history under the announce form. Earlier announcements are
copied from the audit log (their title only).

Revision ID: 0033
Revises: 0032
Create Date: 2026-11-09 18:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0033"
down_revision: str | Sequence[str] | None = "0032"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "announcements",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("kind", sa.String(length=16), nullable=True),
        sa.Column("title", sa.String(length=50), nullable=False),
        sa.Column("body", sa.String(length=140), nullable=True),
        sa.Column("image", sa.String(length=40), nullable=True),
        sa.Column("roles", postgresql.ARRAY(sa.String(length=16)), nullable=True),
        sa.Column("devices", sa.Integer(), nullable=True),
        sa.Column(
            "at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["actor_id"],
            ["users.id"],
            name=op.f("fk_announcements_actor_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_announcements")),
    )
    op.create_index(op.f("ix_announcements_actor_id"), "announcements", ["actor_id"])
    op.execute("ALTER TABLE announcements ENABLE ROW LEVEL SECURITY")
    op.execute(
        "INSERT INTO announcements (actor_id, title, at) "
        "SELECT actor_id, left(target, 50), at FROM admin_audit "
        "WHERE action = 'announce:update' ORDER BY id"
    )


def downgrade() -> None:
    op.drop_table("announcements")
