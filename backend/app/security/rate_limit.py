"""Sliding-window rate limiter shared by every API instance (stored in Postgres).

Each attempt is one row. A transaction-scoped advisory lock per (scope, key) makes
"count, then record" atomic, so concurrent requests cannot slip past the limit.
Keys (emails, IP addresses, ids) are stored only as HMAC(pepper, scope:key): the table
never holds personal data in readable form.
"""

import hashlib
import hmac
import math
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import RateLimitHit

KEEP_HITS = timedelta(days=1)  # longer than any window in use


@dataclass(frozen=True)
class Limit:
    max_hits: int
    window_seconds: float


class RateLimited(Exception):
    def __init__(self, retry_after: int) -> None:
        super().__init__(f"retry after {retry_after}s")
        self.retry_after = retry_after


def _utcnow() -> datetime:
    return datetime.now(UTC)


class RateLimiter:
    def __init__(
        self,
        sessionmaker: async_sessionmaker[AsyncSession],
        pepper: str,
        clock: Callable[[], datetime] = _utcnow,
    ) -> None:
        self._sessionmaker = sessionmaker
        self._pepper = pepper.encode()
        self._clock = clock

    def _key_hash(self, scope: str, key: str) -> bytes:
        return hmac.new(self._pepper, f"{scope}:{key}".encode(), hashlib.sha256).digest()

    async def _over_limit(
        self, session: AsyncSession, scope: str, key_hash: bytes, limit: Limit, now: datetime
    ) -> int | None:
        """Seconds until the next hit is allowed, or None if under the limit."""
        since = now - timedelta(seconds=limit.window_seconds)
        count, oldest = (
            await session.execute(
                select(func.count(), func.min(RateLimitHit.hit_at)).where(
                    RateLimitHit.scope == scope,
                    RateLimitHit.key_hash == key_hash,
                    RateLimitHit.hit_at > since,
                )
            )
        ).one()
        if count < limit.max_hits:
            return None
        retry = (oldest - since).total_seconds()
        return max(1, math.ceil(retry))

    async def check(self, scope: str, key: str, limit: Limit) -> None:
        """Raise RateLimited if the key is already at its limit (does not record a hit)."""
        async with self._sessionmaker() as session:
            retry = await self._over_limit(
                session, scope, self._key_hash(scope, key), limit, self._clock()
            )
        if retry is not None:
            raise RateLimited(retry)

    async def hit(self, scope: str, key: str, limit: Limit) -> None:
        """Atomically check, then record one hit."""
        key_hash = self._key_hash(scope, key)
        lock_id = int.from_bytes(key_hash[:8], "big", signed=True)
        async with self._sessionmaker() as session:
            await session.execute(text("SELECT pg_advisory_xact_lock(:id)"), {"id": lock_id})
            now = self._clock()
            retry = await self._over_limit(session, scope, key_hash, limit, now)
            if retry is not None:
                await session.rollback()  # releases the lock
                raise RateLimited(retry)
            session.add(RateLimitHit(scope=scope, key_hash=key_hash, hit_at=now))
            await session.commit()

    async def record(self, scope: str, key: str) -> None:
        """Record a failure unconditionally (pair with check() before the attempt)."""
        async with self._sessionmaker() as session:
            session.add(
                RateLimitHit(scope=scope, key_hash=self._key_hash(scope, key), hit_at=self._clock())
            )
            await session.commit()

    async def reset(self, scope: str, key: str) -> None:
        async with self._sessionmaker() as session:
            await session.execute(
                delete(RateLimitHit).where(
                    RateLimitHit.scope == scope,
                    RateLimitHit.key_hash == self._key_hash(scope, key),
                )
            )
            await session.commit()


async def delete_old_hits(session: AsyncSession, now: datetime) -> int:
    result = await session.execute(
        delete(RateLimitHit).where(RateLimitHit.hit_at < now - KEEP_HITS)
    )
    return result.rowcount
