"""pending_registrations: no user row until the email code is verified

Sign-ups wait in pending_registrations (password as Argon2 hash, code as HMAC) and become a user
only when the code is entered. Unverified users from the old flow could never sign in; they are
deleted here, together with the per-user code table they used.

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-07 10:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | Sequence[str] | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "pending_registrations",
        sa.Column("email", sa.String(length=254), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("roll_no", sa.String(length=32), nullable=True),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("code_hash", sa.LargeBinary(), nullable=False),
        sa.Column("attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "email = lower(email)", name=op.f("ck_pending_registrations_email_lowercase")
        ),
        sa.CheckConstraint(
            "octet_length(code_hash) = 32", name=op.f("ck_pending_registrations_code_hash_len")
        ),
        sa.CheckConstraint(
            "attempts >= 0", name=op.f("ck_pending_registrations_attempts_non_negative")
        ),
        sa.CheckConstraint(
            "expires_at > created_at", name=op.f("ck_pending_registrations_expires_after_create")
        ),
        sa.PrimaryKeyConstraint("email", name=op.f("pk_pending_registrations")),
    )
    # Every table denies Supabase's Data API (see 0002).
    op.execute("ALTER TABLE pending_registrations ENABLE ROW LEVEL SECURITY")

    op.execute("DELETE FROM users WHERE email_verified_at IS NULL")  # cascades to their codes
    op.drop_table("email_verifications")


def downgrade() -> None:
    op.create_table(
        "email_verifications",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("code_hash", sa.LargeBinary(), nullable=False),
        sa.Column("attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "attempts >= 0", name=op.f("ck_email_verifications_attempts_non_negative")
        ),
        sa.CheckConstraint(
            "expires_at > created_at", name=op.f("ck_email_verifications_expires_after_create")
        ),
        sa.CheckConstraint(
            "octet_length(code_hash) = 32", name=op.f("ck_email_verifications_code_hash_len")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_email_verifications_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_email_verifications")),
    )
    op.execute("ALTER TABLE email_verifications ENABLE ROW LEVEL SECURITY")
    op.drop_table("pending_registrations")  # unfinished sign-ups are simply dropped
