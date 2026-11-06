"""Admin-sent set-password links, and asking for another outing once an approval is used

Revision ID: 0022
Revises: 0021
Create Date: 2026-11-06 18:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0022"
down_revision: str | Sequence[str] | None = "0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_LIVE = "status IN ('pending', 'approved')"
NEW_LIVE = "status IN ('pending', 'approved') AND used_at IS NULL"


def upgrade() -> None:
    op.create_table(
        "account_links",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "purpose",
            sa.Enum(
                "invite",
                "reset",
                name="link_purpose",
                native_enum=False,
                create_constraint=True,
                length=16,
            ),
            nullable=False,
        ),
        sa.Column("token_hash", sa.LargeBinary(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "octet_length(token_hash) = 32", name=op.f("ck_account_links_token_hash_len")
        ),
        sa.CheckConstraint(
            "expires_at > created_at", name=op.f("ck_account_links_expires_after_create")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_account_links_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_account_links_created_by_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_account_links")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_account_links_token_hash")),
    )
    op.create_index(op.f("ix_account_links_expires_at"), "account_links", ["expires_at"])
    op.execute("ALTER TABLE account_links ENABLE ROW LEVEL SECURITY")

    op.add_column(
        "outing_requests", sa.Column("used_at", sa.DateTime(timezone=True), nullable=True)
    )
    # Approvals already taken by an outing: used when that outing left.
    op.execute(
        "UPDATE outing_requests r SET used_at = o.left_at FROM outings o WHERE o.request_id = r.id"
    )
    op.drop_index("uq_outing_requests_one_live_per_day", table_name="outing_requests")
    op.create_index(
        "uq_outing_requests_one_live_per_day",
        "outing_requests",
        ["student_id", "day"],
        unique=True,
        postgresql_where=sa.text(NEW_LIVE),
    )


def downgrade() -> None:
    # Fails if a student has a used approval and a newer live request on the same day; such
    # rows must be resolved by hand before going back.
    op.drop_index("uq_outing_requests_one_live_per_day", table_name="outing_requests")
    op.create_index(
        "uq_outing_requests_one_live_per_day",
        "outing_requests",
        ["student_id", "day"],
        unique=True,
        postgresql_where=sa.text(OLD_LIVE),
    )
    op.drop_column("outing_requests", "used_at")
    op.drop_index(op.f("ix_account_links_expires_at"), table_name="account_links")
    op.drop_table("account_links")
