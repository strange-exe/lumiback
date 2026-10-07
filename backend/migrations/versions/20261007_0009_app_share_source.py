"""share_sessions.source gains 'app': shares started from the mobile app

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-07 18:00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0009"
down_revision: str | Sequence[str] | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NAME = "ck_share_sessions_share_source"


def upgrade() -> None:
    op.drop_constraint(op.f(NAME), "share_sessions", type_="check")
    op.create_check_constraint(
        op.f(NAME), "share_sessions", "source IN ('outing', 'tab_live', 'pairing', 'manual', 'app')"
    )


def downgrade() -> None:
    op.execute("DELETE FROM share_sessions WHERE source = 'app'")
    op.drop_constraint(op.f(NAME), "share_sessions", type_="check")
    op.create_check_constraint(
        op.f(NAME), "share_sessions", "source IN ('outing', 'tab_live', 'pairing', 'manual')"
    )
