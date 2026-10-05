"""Alembic environment.

URL resolution (first match wins):
  1. config.attributes["url"]          — set programmatically by the test suite
  2. `-x db=test`                      — TEST_DATABASE_URL (local *_test database only)
  3. default                           — DATABASE_URL from app settings (all secrets validated)

Migrations use psycopg's sync mode, which works on every platform/event loop.
"""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

from app.config import TestDbSettings, load_settings
from app.models import Base

config = context.config
if config.config_file_name is not None and not config.attributes.get("url"):
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def resolve_url() -> str:
    if url := config.attributes.get("url"):
        return url
    if context.get_x_argument(as_dictionary=True).get("db") == "test":
        return TestDbSettings().test_database_url.get_secret_value()
    return load_settings().database_url.get_secret_value()


def run_migrations_offline() -> None:
    context.configure(
        url=resolve_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(resolve_url(), poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
