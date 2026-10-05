"""enable row level security on every table

Supabase exposes tables in the `public` schema through its Data API (PostgREST) to the `anon`
and `authenticated` roles. We never use that API: the backend connects as the table owner,
which bypasses RLS. Enabling RLS with no policies denies every row to the Data API roles.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-05
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0002"
down_revision: str | Sequence[str] | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = (
    "users",
    "refresh_tokens",
    "contacts",
    "share_sessions",
    "share_viewers",
    "locations",
    "access_log",
    "share_codes",
)


def upgrade() -> None:
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
