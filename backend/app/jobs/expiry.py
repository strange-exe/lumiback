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

from sqlalchemy import delete, func, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import (
    Location,
    RefreshToken,
    SessionStatus,
    ShareCode,
    ShareSession,
    ShareSource,
)
from app.realtime import AccessChanged, Hub
from app.security.rate_limit import delete_old_hits

logger = logging.getLogger(__name__)

INTERVAL_SECONDS = 30.0
KEEP_SPENT_CODES = timedelta(days=1)
KEEP_DEAD_REFRESH_TOKENS = timedelta(days=7)
# A tab-live share ends once the sharer's tab stops checking in (closed, crashed, phone locked).
# The page also stops the share when the tab closes; this is the fallback when that never arrives.
# Generous enough to ride out a background tab's throttled timers.
TAB_IDLE = timedelta(minutes=5)


@dataclass(frozen=True)
class SweepResult:
    expired_sessions: list[uuid.UUID]
    closed_tabs: list[uuid.UUID]
    deleted_codes: int
    deleted_refresh_tokens: int
    deleted_rate_limit_hits: int


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
        closed_tabs = list(
            (
                await session.execute(
                    update(ShareSession)
                    .where(
                        ShareSession.status == SessionStatus.ACTIVE,
                        ShareSession.source == ShareSource.TAB_LIVE,
                        func.coalesce(ShareSession.sharer_seen_at, ShareSession.created_at)
                        < now - TAB_IDLE,
                    )
                    .values(status=SessionStatus.ENDED, ended_at=now, ended_reason="tab_closed")
                    .returning(ShareSession.id)
                )
            ).scalars()
        )
        if ended := expired + closed_tabs:
            await session.execute(delete(Location).where(Location.session_id.in_(ended)))
        codes = await session.execute(
            delete(ShareCode).where(ShareCode.expires_at < now - KEEP_SPENT_CODES)
        )
        tokens = await session.execute(
            delete(RefreshToken).where(RefreshToken.expires_at < now - KEEP_DEAD_REFRESH_TOKENS)
        )
        hits = await delete_old_hits(session, now)
        await session.commit()

    for session_id in expired + closed_tabs:  # after commit: subscribers see committed state
        await hub.publish(AccessChanged(session_id))
    return SweepResult(expired, closed_tabs, codes.rowcount, tokens.rowcount, hits)


async def run_forever(
    sessionmaker: async_sessionmaker[AsyncSession], hub: Hub, interval: float = INTERVAL_SECONDS
) -> None:
    while True:
        try:
            result = await sweep(sessionmaker, hub)
            if result.expired_sessions or result.closed_tabs:
                logger.info(
                    "ended %d expired and %d idle tab-live share sessions",
                    len(result.expired_sessions),
                    len(result.closed_tabs),
                )
        except asyncio.CancelledError:
            raise
        except Exception:
            # Keep sweeping: a transient DB error must not stop expiry housekeeping for good.
            logger.exception("expiry sweep failed")
        await asyncio.sleep(interval)
