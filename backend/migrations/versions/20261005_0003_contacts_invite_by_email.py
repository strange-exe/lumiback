"""contacts: invite by email

Invitations are keyed by email so an invite looks the same whether or not the account exists.
contact_user_id becomes nullable and is set only when the invite is accepted.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | Sequence[str] | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Add nullable, backfill from the linked user, then enforce NOT NULL (safe with existing rows).
    op.add_column("contacts", sa.Column("contact_email", sa.String(length=254), nullable=True))
    op.execute(
        "UPDATE contacts c SET contact_email = u.email FROM users u WHERE u.id = c.contact_user_id"
    )
    op.alter_column("contacts", "contact_email", nullable=False)
    op.alter_column("contacts", "contact_user_id", existing_type=sa.UUID(), nullable=True)

    op.create_index(op.f("ix_contacts_contact_email"), "contacts", ["contact_email"], unique=False)
    op.create_unique_constraint(
        op.f("uq_contacts_owner_id_contact_email"), "contacts", ["owner_id", "contact_email"]
    )
    op.create_check_constraint(
        op.f("ck_contacts_email_lowercase"), "contacts", "contact_email = lower(contact_email)"
    )
    op.create_check_constraint(
        op.f("ck_contacts_accepted_has_user"),
        "contacts",
        "(status = 'accepted') = (contact_user_id IS NOT NULL)",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_contacts_accepted_has_user"), "contacts", type_="check")
    op.drop_constraint(op.f("ck_contacts_email_lowercase"), "contacts", type_="check")
    op.drop_constraint(op.f("uq_contacts_owner_id_contact_email"), "contacts", type_="unique")
    op.drop_index(op.f("ix_contacts_contact_email"), table_name="contacts")
    # Pending invites have no user and cannot exist in the old schema.
    op.execute("DELETE FROM contacts WHERE contact_user_id IS NULL")
    op.alter_column("contacts", "contact_user_id", existing_type=sa.UUID(), nullable=False)
    op.drop_column("contacts", "contact_email")
