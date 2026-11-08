"""Periodic sweep: persist expiry, delete expired locations, notify live viewers, tidy up.

Correctness never depends on this job: can_view() checks `ends_at` on every read and send.
The sweep makes expiry visible in the database, enforces data minimization (no location is
kept for an ended session), and closes idle WebSocket viewers whose sharer stopped sending.
Every statement is idempotent, so running several instances at once is safe.
"""

import asyncio
import logging
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, case, delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.email import Mailer
from app.models import (
    AccessLog,
    AdminAudit,
    CampusSettings,
    Escalation,
    GateScan,
    HelpRequest,
    Location,
    Outing,
    OutingRequest,
    PushToken,
    RefreshToken,
    SessionStatus,
    ShareCode,
    ShareSession,
    ShareSource,
)
from app.push import PushSender, ReceiptCheck, check_receipts
from app.realtime import AccessChanged, Hub
from app.security.rate_limit import delete_old_hits
from app.services import (
    account_links,
    alerts,
    escalations,
    outbox,
    password_reset,
    safe_return,
    verification,
)
from app.services.outbox import Delivery
from app.services.rules import IST

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
DEFAULT_SCAN_RETENTION_DAYS = 180
# Fixed periods (owner decision, 2026-11-05; the privacy page states them).
KEEP_ADMIN_AUDIT = timedelta(days=365)
# The app re-registers its push token on every start, so a token unseen this long belongs to a
# phone that no longer runs Lumiback (uninstalled, reset, or replaced).
KEEP_UNSEEN_PUSH_TOKENS = timedelta(days=90)
# A help request's location fix is for the night it was sent, not for the record.
KEEP_HELP_FIX = timedelta(days=1)


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
    escalated: int = 0
    deleted_views: int = 0
    deleted_requests: int = 0
    deleted_escalations: int = 0
    deleted_detached_outings: int = 0  # deleted accounts' outings past the retention period
    deleted_audit: int = 0
    deleted_push_tokens: int = 0
    push_receipts: ReceiptCheck = ReceiptCheck()
    followed_up: int = 0  # unclaimed escalations re-alerted or handed to the head wardens
    reminded_requests: int = 0  # pending requests reminded or sent to a backup approver
    alerts: Delivery = Delivery()  # what the outbox sent this sweep
    deleted_alerts: int = 0
    deleted_help: int = 0


class SweepHealth:
    """When the sweep last finished, for GET /health.

    The sweep sends late alerts and escalations, and a failing one only writes a log line.
    This lets an outside pinger notice: the sweep is "stale" once `STALE_AFTER_SWEEPS`
    intervals pass without a successful run. Counting starts at start-up, so a fresh process
    gets the same grace before its first sweep. A hung sweep goes stale too, since it never
    finishes. Monotonic clock: a wall-clock jump must not fake a stale or a fresh sweep.
    """

    STALE_AFTER_SWEEPS = 3

    def __init__(
        self, interval: float = INTERVAL_SECONDS, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self._clock = clock
        self._stale_after = interval * self.STALE_AFTER_SWEEPS
        self._last_ok = clock()  # start-up counts as the baseline (the grace period)

    def mark_ok(self) -> None:
        self._last_ok = self._clock()

    def status(self) -> str:
        return "stale" if self._clock() - self._last_ok > self._stale_after else "ok"


async def sweep(
    sessionmaker: async_sessionmaker[AsyncSession],
    hub: Hub,
    push: PushSender | None = None,
    mailer: Mailer | None = None,
    web_url: str = "",
    pepper: str | None = None,  # the code pepper: safe-return watch links (none without it)
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
            # An expired safe-return share: its contact gets nothing more, so forget them.
            await safe_return.forget_address(session, ended)
        codes = await session.execute(
            delete(ShareCode).where(ShareCode.expires_at < now - KEEP_SPENT_CODES)
        )
        tokens = await session.execute(
            delete(RefreshToken).where(RefreshToken.expires_at < now - KEEP_DEAD_REFRESH_TOKENS)
        )
        hits = await delete_old_hits(session, now)
        pending = await verification.delete_expired(session, now)  # unverified sign-ups
        resets = await password_reset.delete_expired(session, now)  # unused reset codes
        await account_links.delete_expired(session, now)  # unused set-password links
        # Alerts go into the outbox in this transaction and are sent after the commit, so a
        # failed send or a crash can't lose one (services/outbox.py).
        late = await alerts.late_alerts(session, now, web_url)
        # The contacts following these students (safe return), told at the same moment. Not
        # queued: the email carries the watch link, which is never stored.
        contacts_told = (
            await safe_return.overdue_emails(session, now, web_url, pepper)
            if late and pepper is not None
            else []
        )
        opened = await escalations.open_escalations(session, now)
        await alerts.escalation_opened(session, opened, web_url)
        timings = await alerts.timings(session)
        followed_up = await alerts.escalation_follow_ups(session, now, timings, web_url)
        reminded = await alerts.request_reminders(session, now, timings, web_url)
        # One retention period (Admin > Settings) for the campus records: gate scans, who
        # viewed a share, outing requests, and handled late escalations. Open escalations
        # stay until an admin resolves them: deleting one would hide a late student.
        retention = await session.scalar(select(CampusSettings.scan_retention_days))
        cutoff = now - timedelta(days=retention or DEFAULT_SCAN_RETENTION_DAYS)
        scans = await session.execute(delete(GateScan).where(GateScan.scanned_at < cutoff))
        views = await session.execute(delete(AccessLog).where(AccessLog.viewed_at < cutoff))
        # A request behind an open escalation keeps the contacts the student gave for that
        # outing, which the admin following up needs.
        escalated = (
            select(Outing.id)
            .join(Escalation, Escalation.outing_id == Outing.id)
            .where(Outing.request_id == OutingRequest.id, Escalation.resolved_at.is_(None))
        )
        old_requests = await session.execute(
            delete(OutingRequest).where(
                OutingRequest.day < cutoff.astimezone(IST).date(), ~escalated.exists()
            )
        )
        handled = await session.execute(
            delete(Escalation).where(
                Escalation.resolved_at.is_not(None), Escalation.created_at < cutoff
            )
        )
        # A deleted account's outings (with their escalations and corrections, and freeing
        # the request each used) stay with the hostel's record for the same period, counted
        # from the deletion rather than from the trip: the office keeps a full period to
        # answer for any recent outing whenever the account was deleted, and a deletion never
        # shortens what it already had. (A live account's outings aren't purged at all.)
        detached = await session.execute(
            delete(Outing).where(Outing.student_id.is_(None), Outing.detached_at < cutoff)
        )
        audit = await session.execute(
            delete(AdminAudit).where(AdminAudit.at < now - KEEP_ADMIN_AUDIT)
        )
        stale_devices = await session.execute(
            delete(PushToken).where(PushToken.last_seen_at < now - KEEP_UNSEEN_PUSH_TOKENS)
        )
        # Help requests: the one location fix is kept a day, the request itself like a
        # handled escalation (open ones stay until someone handles them).
        await session.execute(
            update(HelpRequest)
            .where(HelpRequest.created_at < now - KEEP_HELP_FIX, HelpRequest.lat.is_not(None))
            .values(lat=None, lng=None, accuracy_m=None)
        )
        old_help = await session.execute(
            delete(HelpRequest).where(
                HelpRequest.handled_at.is_not(None), HelpRequest.created_at < cutoff
            )
        )
        old_alerts = await outbox.delete_old(session)
        await session.commit()

    for session_id in expired + closed_tabs:  # after commit: subscribers see committed state
        await hub.publish(AccessChanged(session_id))
    if mailer is not None:
        for email in contacts_told:
            await safe_return.send(mailer, email)
    try:  # this sweep's alerts, and earlier ones waiting for a retry
        delivered = await outbox.deliver(sessionmaker, push, mailer)
    except Exception:
        logger.exception("alert delivery failed")  # the rows stay for the next sweep
        delivered = outbox.Delivery()
    receipts = ReceiptCheck()
    if push is not None:
        try:  # last: the alerts above matter more than confirming earlier pushes
            receipts = await check_receipts(sessionmaker, push, now)
        except Exception:
            logger.exception("push receipt check failed")  # tickets stay for the next sweep
    return SweepResult(
        expired,
        closed_tabs,
        codes.rowcount,
        tokens.rowcount,
        hits,
        pending,
        overdue_notified=late,
        escalated=len(opened),
        followed_up=followed_up,
        reminded_requests=reminded,
        alerts=delivered,
        deleted_alerts=old_alerts,
        deleted_help=old_help.rowcount,
        deleted_scans=scans.rowcount,
        deleted_views=views.rowcount,
        deleted_requests=old_requests.rowcount,
        deleted_escalations=handled.rowcount,
        deleted_detached_outings=detached.rowcount,
        deleted_password_resets=resets,
        deleted_audit=audit.rowcount,
        deleted_push_tokens=stale_devices.rowcount,
        push_receipts=receipts,
    )


async def run_forever(
    sessionmaker: async_sessionmaker[AsyncSession],
    hub: Hub,
    push: PushSender | None = None,
    mailer: Mailer | None = None,
    web_url: str = "",
    interval: float = INTERVAL_SECONDS,
    health: SweepHealth | None = None,
    pepper: str | None = None,
) -> None:
    while True:
        try:
            result = await sweep(sessionmaker, hub, push, mailer, web_url, pepper)
            if health is not None:
                health.mark_ok()
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
