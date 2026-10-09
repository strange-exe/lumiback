"""Form days can have no-form evenings; Saturday follows the weekday rules

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-09 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: str | Sequence[str] | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("day_rules", sa.Column("no_form_from", sa.Time(), nullable=True))
    op.create_check_constraint(
        op.f("ck_day_rules_no_form_order"),
        "day_rules",
        "no_form_from IS NULL OR "
        "(needs_form AND no_form_from >= opens_at AND no_form_from < return_by)",
    )
    # Current hostel practice. Only rows still holding the 0014 starting values change, so
    # anything an admin already edited is kept.
    # Boys' hostels: on Sundays, 6-8 PM needs no form (like a weekday evening).
    op.execute(
        """
        UPDATE day_rules SET no_form_from = '18:00'
        WHERE day_type = 'sunday' AND needs_form
          AND opens_at <= '18:00' AND return_by > '18:00'
          AND rule_set_id = (SELECT id FROM rule_sets WHERE name = 'Boys'' hostels')
        """
    )
    # Saturday isn't a weekend day for now: the weekday rules apply.
    op.execute(
        """
        UPDATE day_rules
        SET opens_at = '18:00', return_by = '20:00', max_minutes = NULL, needs_form = false
        WHERE day_type = 'saturday'
          AND opens_at = '10:00' AND return_by = '20:00' AND needs_form
          AND rule_set_id IN (
              SELECT id FROM rule_sets WHERE name IN ('Boys'' hostels', 'Girls'' hostels')
          )
        """
    )


def downgrade() -> None:
    # Saturday's values are ordinary rule data an admin can change; they stay as they are.
    op.drop_constraint(op.f("ck_day_rules_no_form_order"), "day_rules", type_="check")
    op.drop_column("day_rules", "no_form_from")
