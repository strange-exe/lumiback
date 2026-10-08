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

from sqlalchemy import and_, case, delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import (
    CampusSettings,
    GateScan,
    Location,
    Outing,
    RefreshToken,
    SessionStatus,
    ShareCode,
    ShareSession,
    ShareSource,
)
from app.push import PushMessage, PushSender, notify_user
from app.realtime import AccessChanged, Hub
from app.security.rate_limit import delete_old_hits
from app.services import password_reset, verification

logger = logging.getLogger(__name__)

INTERVAL_SECONDS = 30.0
KEEP_SPENT_CODES = timedelta(days=1)
KEEP_DEAD_REFRESH_TOKENS = timedelta(days=7)
# A tab-live share ends once the sharer's tab stops checking in (closed, crashed, phone locked).
# The page also stops the share when the tab closes; this is the fallback when that never arrives.
# Generous enough to ride out a background tab's throttled timers.
TAB_IDLE = timedelta(minutes=5)
# App shares report from a background service; if it stops (app killed, phone off) for this long,
# the share ends. Longer than tabs: Android may batch updates while the phone sleeps.
APP_IDLE = timedelta(minutes=15)
# The phone's own reminders fire at the due time; this later push says "you're really late",
# once per outing, and reaches the student even if reminders were turned off on the phone.
OVERDUE_PUSH_AFTER = timedelta(minutes=30)
DEFAULT_SCAN_RETENTION_DAYS = 180


@dataclass(frozen=True)
class SweepResult:
    expired_sessions: list[uuid.UUID]
    closed_tabs: list[uuid.UUID]
    deleted_codes: int
    deleted_refresh_tokens: int
    deleted_rate_limit_hits: int
    deleted_pending_signups: int = 0
    overdue_notified: int = 0
    deleted_scans: int = 0
    deleted_password_resets: int = 0


async def sweep(
    sessionmaker: async_sessionmaker[AsyncSession], hub: Hub, push: PushSender | None = None
) -> SweepResult:
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
        last_seen = func.coalesce(ShareSession.sharer_seen_at, ShareSession.created_at)
        closed_tabs = list(
            (
                await session.execute(
                    update(ShareSession)
                    .where(
                        ShareSession.status == SessionStatus.ACTIVE,
                        or_(
                            and_(
                                ShareSession.source == ShareSource.TAB_LIVE,
                                last_seen < now - TAB_IDLE,
                            ),
                            and_(
                                ShareSession.source == ShareSource.APP, last_seen < now - APP_IDLE
                            ),
                        ),
                    )
                    .values(
                        status=SessionStatus.ENDED,
                        ended_at=now,
                        ended_reason=case(
                            (ShareSession.source == ShareSource.TAB_LIVE, "tab_closed"),
                            else_="device_quiet",
                        ),
                    )
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
        pending = await verification.delete_expired(session, now)  # unverified sign-ups
        resets = await password_reset.delete_expired(session, now)  # unused reset codes
        late = list(
            await session.execute(
                update(Outing)
                .where(
                    Outing.returned_at.is_(None),
                    Outing.overdue_notified_at.is_(None),
                    Outing.expected_return_at < now - OVERDUE_PUSH_AFTER,
                )
                .values(overdue_notified_at=now)
                .returning(Outing.student_id)
            )
        )
        retention = await session.scalar(select(CampusSettings.scan_retention_days))
        scans = await session.execute(
            delete(GateScan).where(
                GateScan.scanned_at < now - timedelta(days=retention or DEFAULT_SCAN_RETENTION_DAYS)
            )
        )
        await session.commit()

    for session_id in expired + closed_tabs:  # after commit: subscribers see committed state
        await hub.publish(AccessChanged(session_id))
    if push is not None:
        for (student_id,) in late:
            await notify_user(
                sessionmaker,
                push,
                student_id,
                PushMessage(
                    title="You're past your return time",
                    body="Mark yourself back, or add time so nobody worries.",
                    url="/today",
                    channel="return-reminders",
                ),
            )
    return SweepResult(
        expired,
        closed_tabs,
        codes.rowcount,
        tokens.rowcount,
        hits,
        pending,
        overdue_notified=len(late),
        deleted_scans=scans.rowcount,
        deleted_password_resets=resets,
    )


async def run_forever(
    sessionmaker: async_sessionmaker[AsyncSession],
    hub: Hub,
    push: PushSender | None = None,
    interval: float = INTERVAL_SECONDS,
) -> None:
    while True:
        try:
            result = await sweep(sessionmaker, hub, push)
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
