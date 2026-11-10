"""Indexes for the office search: "contains" searches by name, email or roll number (People,
Students, Scans) without reading every user, lists by name, and scans by hostel or result.

The "contains" searches (`LIKE '%q%'`) can't use a B-tree; pg_trgm's GIN operator class can.
Each trigram index's expression is exactly the one the search sends (services/admin.py
`_anyone_matching` and `name_or_roll`): `lower(name)`, `email` (stored lower case) and
`lower(coalesce(roll_no, ''))`. Changing a search's expression means changing its index too
(tests/test_migrations.py checks the planner can still use them).

pg_trgm ships with Postgres and Supabase, and is a trusted extension. On Supabase it goes in
the `extensions` schema (its advisor flags extensions in `public`); elsewhere (local, CI) in
the default schema. The indexes name the operator class with its schema, so they work wherever
the extension is. The downgrade drops the indexes but keeps the extension: it may have been
there before this revision, and something else may use it.

Revision ID: 0035
Revises: 0034
Create Date: 2026-11-10 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0035"
down_revision: str | Sequence[str] | None = "0034"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TRIGRAM = [
    ("ix_users_name_trgm", "lower(name)"),
    ("ix_users_email_trgm", "email"),
    ("ix_users_roll_no_trgm", "lower(coalesce(roll_no, ''))"),
]
# No index for lists by name or role (measured, left out): with (role, name, id) the planner
# walked it for the search's ORDER BY role DESC and a common-name search got slower (0.7 -> 9.3
# ms at 5,000 users); (name, id) made Students' "contains" searches slower once psycopg prepares
# them (generic plans, up to 6 -> 12 ms).
BTREE = [
    # Students and Scans filtered by the student's hostel (a warden's own hostels too).
    ("ix_users_hostel_name", "users", ["hostel_id", "name"]),
    # Scans filtered by result, newest first: without it, a hostel's refused scans read the
    # whole table.
    ("ix_gate_scans_result_id", "gate_scans", ["result", "id"]),
]


def upgrade() -> None:
    op.execute(
        "DO $$ BEGIN "
        "IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN "
        "CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions; "
        "ELSE CREATE EXTENSION IF NOT EXISTS pg_trgm; "
        "END IF; END $$"
    )
    schema = (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT quote_ident(n.nspname) FROM pg_extension e "
                "JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pg_trgm'"
            )
        )
        .scalar_one()
    )
    for name, expression in TRIGRAM:
        op.execute(f"CREATE INDEX {name} ON users USING gin ({expression} {schema}.gin_trgm_ops)")
    for name, table, columns in BTREE:
        op.create_index(name, table, columns)


def downgrade() -> None:
    for name, table, _ in reversed(BTREE):
        op.drop_index(name, table_name=table)
    for name, _ in reversed(TRIGRAM):
        op.drop_index(name, table_name="users")
