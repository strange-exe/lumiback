"""Sliding-window rate limiter shared by every API instance (stored in Postgres).

Each attempt is one row. A transaction-scoped advisory lock per (scope, key) makes
"count, then record" atomic, so concurrent requests cannot slip past the limit.
Keys (emails, IP addresses, ids) are stored only as HMAC(pepper, scope:key): the table
never holds personal data in readable form.
"""

import hashlib
import hmac
import math
from collections.abc import Callable, Sequence
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
        await self.hit_all([(scope, key, limit)])

    async def hit_all(self, hits: Sequence[tuple[str, str, Limit]]) -> list[int]:
        """Atomically check every (scope, key, limit), then record one hit on each: either all
        are under their limit and all are counted, or RateLimited is raised and none is.
        Returns the recorded hits' ids (for undo)."""
        keyed = [(scope, self._key_hash(scope, key), limit) for scope, key, limit in hits]
        async with self._sessionmaker() as session:
            # Always in the same order, so two callers locking overlapping keys can't deadlock.
            for lock_id in sorted({int.from_bytes(h[:8], "big", signed=True) for _, h, _ in keyed}):
                await session.execute(text("SELECT pg_advisory_xact_lock(:id)"), {"id": lock_id})
            now = self._clock()
            for scope, key_hash, limit in keyed:
                retry = await self._over_limit(session, scope, key_hash, limit, now)
                if retry is not None:
                    await session.rollback()  # releases the locks
                    raise RateLimited(retry)
            recorded = [
                RateLimitHit(scope=scope, key_hash=key_hash, hit_at=now)
                for scope, key_hash, _ in keyed
            ]
            session.add_all(recorded)
            await session.flush()  # assigns the ids (read now: commit expires the objects)
            ids = [hit.id for hit in recorded]
            await session.commit()
        return ids

    async def undo(self, hit_ids: Sequence[int]) -> None:
        """Remove exactly these recorded hits (from hit_all): the attempt they counted didn't
        happen. Removing hits only ever lowers a count, so it can't let a burst past a limit."""
        if not hit_ids:
            return
        async with self._sessionmaker() as session:
            await session.execute(delete(RateLimitHit).where(RateLimitHit.id.in_(hit_ids)))
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
