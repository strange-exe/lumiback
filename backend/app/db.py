"""Async database engine and per-request sessions.

Windows note: psycopg's async mode cannot run on the default ProactorEventLoop. Run the dev
server with `--loop asyncio:SelectorEventLoop`. Linux (production) is unaffected.
"""

from collections.abc import AsyncIterator

from fastapi import Request
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

# Small pools: the Supabase session pooler caps client connections per project. Requests (and
# the sweep) get up to 8; the rate limiter has its own 2, so the API still opens at most 10.
#
# Why the limiter has its own pool: a request's session holds its connection (it read the
# signed-in user) while the limiter counts a hit in a transaction of its own. Drawn from the
# same pool, a full pool would leave every such request holding one connection and waiting for
# a second that only another waiting request could free, until all timed out (hold-and-wait).
# The limiter's work never waits on the request pool and is one short transaction, so a
# request waiting for a limiter connection waits only for another hit to finish.
REQUEST_POOL = {"pool_size": 5, "max_overflow": 3}
LIMITER_POOL = {"pool_size": 2, "max_overflow": 0}


def make_engine(url: str, *, pool_size: int, max_overflow: int) -> AsyncEngine:
    return create_async_engine(
        url, pool_size=pool_size, max_overflow=max_overflow, pool_pre_ping=True
    )


def make_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.sessionmaker() as session:
        yield session
