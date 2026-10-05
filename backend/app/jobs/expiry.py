"""Periodic sweep: persist expiry, delete expired locations, notify live viewers, tidy up.

Correctness never depends on this job: can_view() checks `ends_at` on every read and send.
The sweep makes expiry visible in the database, enforces data minimization (no location is
kept for an ended session), and closes idle WebSocket viewers whose sharer stopped sending.
Every statement is idempotent, so running several instances at once is safe.
"""

import asyncio
import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import Location, RefreshToken, SessionStatus, ShareCode, ShareSession
from app.realtime import AccessChanged, Hub

logger = logging.getLogger(__name__)

INTERVAL_SECONDS = 30.0
KEEP_SPENT_CODES = timedelta(days=1)
KEEP_DEAD_REFRESH_TOKENS = timedelta(days=7)


@dataclass(frozen=True)
class SweepResult:
    expired_sessions: list[uuid.UUID]
    deleted_codes: int
    deleted_refresh_tokens: int


async def sweep(sessionmaker: async_sessionmaker[AsyncSession], hub: Hub) -> SweepResult:
    now = datetime.now(UTC)
    async with sessionmaker() as session:
        expired = list(
            (
                await session.execute(
                    update(ShareSession)
                    .where(ShareSession.status == SessionStatus.ACTIVE, ShareSession.ends_at <= now)
                    .values(status=SessionStatus.ENDED, ended_at=now, ended_reason="expired")
                    .returning(ShareSession.id)
                )
            ).scalars()
        )
        if expired:
            await session.execute(delete(Location).where(Location.session_id.in_(expired)))
        codes = await session.execute(
            delete(ShareCode).where(ShareCode.expires_at < now - KEEP_SPENT_CODES)
        )
        tokens = await session.execute(
            delete(RefreshToken).where(RefreshToken.expires_at < now - KEEP_DEAD_REFRESH_TOKENS)
        )
        await session.commit()

    for session_id in expired:  # after commit, so subscribers re-check committed state
        await hub.publish(AccessChanged(session_id))
    return SweepResult(expired, codes.rowcount, tokens.rowcount)


async def run_forever(
    sessionmaker: async_sessionmaker[AsyncSession], hub: Hub, interval: float = INTERVAL_SECONDS
) -> None:
    while True:
        try:
            result = await sweep(sessionmaker, hub)
            if result.expired_sessions:
                logger.info("expired %d share sessions", len(result.expired_sessions))
        except asyncio.CancelledError:
            raise
        except Exception:
            # Keep sweeping: a transient DB error must not stop expiry housekeeping for good.
            logger.exception("expiry sweep failed")
        await asyncio.sleep(interval)
