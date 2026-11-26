"""The hostel board: posts from the hostel office (timings, mess, laundry, maintenance) for
every student in some hostels or in all of them, the hostels each is for, and which students
opened the board with it on screen (only ever shown as a count). push_tokens.board: the app
created the "Hostel board" notification channel; every phone registered so far runs an app
without it, so false until it registers again.

Revision ID: 0037
Revises: 0036
Create Date: 2026-11-25 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0037"
down_revision: str | Sequence[str] | None = "0036"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ROLES = ("student", "warden", "head_warden", "admin", "developer")
CATEGORIES = ("timings", "mess", "laundry", "maintenance", "general")


def _enum(name: str, *values: str) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False, create_constraint=True, length=16)


def upgrade() -> None:
    op.create_table(
        "board_posts",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("author_id", sa.Uuid(), nullable=True),
        sa.Column("author_role", _enum("author_role", *ROLES), nullable=False),
        sa.Column("category", _enum("board_category", *CATEGORIES), nullable=False),
        sa.Column("title", sa.String(length=60), nullable=False),
        sa.Column("body", sa.String(length=600), nullable=False),
        sa.Column("all_hostels", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("students", sa.Integer(), nullable=False),
        sa.Column("devices", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("withdrawn_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("withdrawn_by", sa.Uuid(), nullable=True),
        sa.CheckConstraint(
            "expires_at > created_at", name=op.f("ck_board_posts_expires_after_create")
        ),
        sa.ForeignKeyConstraint(
            ["author_id"],
            ["users.id"],
            name=op.f("fk_board_posts_author_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["withdrawn_by"],
            ["users.id"],
            name=op.f("fk_board_posts_withdrawn_by_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_board_posts")),
    )
    op.create_index(op.f("ix_board_posts_author_id"), "board_posts", ["author_id"])
    op.execute("ALTER TABLE board_posts ENABLE ROW LEVEL SECURITY")

    op.create_table(
        "board_post_hostels",
        sa.Column("post_id", sa.BigInteger(), nullable=False),
        sa.Column("hostel_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(
            ["post_id"],
            ["board_posts.id"],
            name=op.f("fk_board_post_hostels_post_id_board_posts"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["hostel_id"],
            ["hostels.id"],
            name=op.f("fk_board_post_hostels_hostel_id_hostels"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("post_id", "hostel_id", name=op.f("pk_board_post_hostels")),
    )
    op.create_index(op.f("ix_board_post_hostels_hostel_id"), "board_post_hostels", ["hostel_id"])
    op.execute("ALTER TABLE board_post_hostels ENABLE ROW LEVEL SECURITY")

    op.create_table(
        "board_post_seen",
        sa.Column("post_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(
            ["post_id"],
            ["board_posts.id"],
            name=op.f("fk_board_post_seen_post_id_board_posts"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_board_post_seen_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("post_id", "user_id", name=op.f("pk_board_post_seen")),
    )
    op.create_index(op.f("ix_board_post_seen_user_id"), "board_post_seen", ["user_id"])
    op.execute("ALTER TABLE board_post_seen ENABLE ROW LEVEL SECURITY")

    # The students each post was for when sent: seen counts are over this group only.
    op.create_table(
        "board_post_audience",
        sa.Column("post_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(
            ["post_id"],
            ["board_posts.id"],
            name=op.f("fk_board_post_audience_post_id_board_posts"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_board_post_audience_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("post_id", "user_id", name=op.f("pk_board_post_audience")),
    )
    op.create_index(op.f("ix_board_post_audience_user_id"), "board_post_audience", ["user_id"])
    op.execute("ALTER TABLE board_post_audience ENABLE ROW LEVEL SECURITY")

    op.add_column(
        "push_tokens",
        sa.Column("board", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("board_post_audience")
    op.drop_table("board_post_seen")
    op.drop_table("board_post_hostels")
    op.drop_table("board_posts")
    op.drop_column("push_tokens", "board")
