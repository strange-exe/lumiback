"""The alert outbox: alerts are saved with the change that causes them and sent after it.

Before this, late alerts and escalation messages were sent after the sweep's commit from
memory: a crash, a restart or a failed send lost them. Now every alert is a row in
`alert_outbox`, written in the same transaction as its cause (the outing marked late, the
escalation opened, the help request saved), so it exists exactly when its cause does.

Sending (`deliver`), after the commit, by the sweep every 30 s and, for alerts a person just
caused (help, a notice), straight away as a background task:
- One row at a time is claimed with FOR UPDATE SKIP LOCKED and leased for LEASE (its next
  try moves past the lease), so two senders (the sweep and a background task, or two
  instances) never send the same row at once, and a sender that dies mid-send leaves the
  row to be tried again once the lease runs out.
- Order: safety alerts first (urgent pushes and every email-only alert), and within each
  group fresh alerts before retries, then oldest first. A row that keeps failing can't hold
  back the alerts queued after it.
- Push down: after the first push failure (an error, a timeout, or every phone failed) a
  pass stops trying push. Alerts with an email to fall back on (urgent ones, and any on their
  last try) are emailed straight away; the others wait, untried, for the next pass.
- Time budget: a pass stops claiming once BUDGET_SECONDS have passed, and a push still
  waiting for the push service when the budget runs out is cut off (and counts as failed).
- The recipient is checked again when sending, not only when queued: an account turned off
  (or no longer staff, for the office's alerts; no longer following, for a follower's; no
  longer a granted viewer of the share, for "sharing timed out") gets
  nothing, and the row is given up with its payload emptied. Emails go to the account's
  address now, not the one it had when queued.
- Sent: `sent_at` set and the payload emptied (it can hold an address or a location).
- Failed: tried again after a backoff that doubles from 30 s up to 30 min; after
  MAX_ATTEMPTS it is given up on (`failed_at`, logged as an error).
- Idempotent: each alert has a unique `key`, so enqueuing it twice adds nothing. An email
  carries the key to Resend, which sends one key at most once in 24 hours, so a retry after
  a send whose answer was lost can't arrive twice. Expo push has no such key: a push whose
  answer was lost (timeout) may arrive twice, which beats a lost safety alert.
- Logs name the alert's id, kind and the error's type only: never an address, and never a
  provider's answer (which can quote the address).

Times are the database's clock (now()), the one the rows are written with.
"""

import hashlib
import logging
import time
import uuid
from collections.abc import Iterable
from dataclasses import asdict, dataclass
from datetime import timedelta
from typing import Any

import anyio
from sqlalchemy import and_, case, delete, exists, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.email import Email, Mailer
from app.models import (
    AlertOutbox,
    OutboxMode,
    PushToken,
    SessionStatus,
    ShareSession,
    ShareViewer,
    User,
    UserRole,
    ViewerStatus,
)
from app.push import PushMessage, PushOutcome, PushSender, push_devices

logger = logging.getLogger(__name__)

LEASE = timedelta(minutes=2)  # longer than one send can take (push: ~33 s at worst)
FIRST_RETRY = timedelta(seconds=30)
MAX_RETRY = timedelta(minutes=30)
MAX_ATTEMPTS = 8  # about an hour of tries in all
# Sent rows (and given-up ones) are kept this long for troubleshooting, then deleted.
KEEP_DONE = timedelta(days=7)
# One pass stops claiming after this, and cuts off a push still waiting then, so a dead push
# service can't hold the sweep (whose health check goes stale after 90 s); the rest wait for
# the next pass. An email in progress finishes (its own timeout is 15 s).
BUDGET_SECONDS = 20.0


def backoff(attempts: int) -> timedelta:
    """The wait after the `attempts`-th failed try: 30 s, 1 min, 2 min ... at most 30 min."""
    return min(FIRST_RETRY * 2 ** max(attempts - 1, 0), MAX_RETRY)


async def enqueue(
    session: AsyncSession,
    *,
    key: str,
    kind: str,
    mode: OutboxMode,
    user_id: uuid.UUID | None = None,
    push: PushMessage | None = None,
    email: Email | None = None,
    staff_only: bool = False,
    follows: uuid.UUID | None = None,
    viewer_of: uuid.UUID | None = None,
) -> int | None:
    """Adds an alert to the caller's transaction (sent once that commits). Returns its id, or
    None if an alert with this key was already queued. `staff_only`: the office's alert, sent
    only while the recipient is still staff. `follows`: a follower's alert, sent only while
    the recipient still follows this student's live share. `viewer_of`: about that share (a
    share that just ended), sent only while the recipient is still a granted viewer of it."""
    payload: dict[str, Any] = {}
    if push is not None:
        payload["push"] = asdict(push)
    if email is not None:
        payload["email"] = {
            "to": email.to,
            "subject": email.subject,
            "body": email.body,
            "html": email.html,
        }
    if staff_only:
        payload["staff_only"] = True
    if follows is not None:
        payload["follows"] = str(follows)
    if viewer_of is not None:
        payload["viewer_of"] = str(viewer_of)
    if mode is not OutboxMode.EMAIL and (user_id is None or push is None):
        raise ValueError("a push alert needs a user and a message")
    if mode is not OutboxMode.PUSH and email is None:
        raise ValueError("an email alert needs an email")
    if (staff_only or follows is not None or viewer_of is not None) and user_id is None:
        raise ValueError("a recipient check needs the recipient")
    return await session.scalar(
        insert(AlertOutbox)
        .values(key=key[:200], kind=kind, mode=mode, user_id=user_id, payload=payload)
        .on_conflict_do_nothing(index_elements=[AlertOutbox.key])
        .returning(AlertOutbox.id)
    )


async def cancel(session: AsyncSession, key_prefixes: Iterable[str]) -> int:
    """Gives up the unsent alerts whose key starts with one of these, emptying their payload
    (the caller commits). Returns how many."""
    prefixes = list(key_prefixes)
    if not prefixes:
        return 0
    result = await session.execute(
        update(AlertOutbox)
        .where(
            AlertOutbox.sent_at.is_(None),
            AlertOutbox.failed_at.is_(None),
            or_(*(AlertOutbox.key.startswith(p, autoescape=True) for p in prefixes)),
        )
        .values(failed_at=func.now(), payload={}, last_error="cancelled")
    )
    return result.rowcount


@dataclass(frozen=True)
class _Claimed:
    id: int
    key: str
    kind: str
    mode: OutboxMode
    user_id: uuid.UUID | None
    payload: dict[str, Any]
    attempts: int


class _Retry(Exception):
    """Nothing was delivered that should have been: try again later."""


class _GiveUp(Exception):
    """The recipient may no longer have this alert: never send it."""


_URGENT = AlertOutbox.payload["push"]["urgent"].as_boolean().is_(True)
# Email-only alerts are safety mail (escalations, Help to a contact): they go with the urgent.
_SAFETY = or_(AlertOutbox.mode == OutboxMode.EMAIL, _URGENT)
# What can still go while push is down: emails, and push-or-email alerts that would fall back
# to their email (urgent, or on their last try; `attempts` is counted when claimed).
_NEEDS_NO_PUSH = or_(
    AlertOutbox.mode == OutboxMode.EMAIL,
    and_(
        AlertOutbox.mode == OutboxMode.PUSH_OR_EMAIL,
        or_(_URGENT, AlertOutbox.attempts >= MAX_ATTEMPTS - 1),
    ),
)


async def _claim(
    sessionmaker: async_sessionmaker[AsyncSession],
    ids: list[int] | None,
    push_ok: bool = True,
) -> _Claimed | None:
    async with sessionmaker() as session:
        query = (
            select(AlertOutbox)
            .where(
                AlertOutbox.sent_at.is_(None),
                AlertOutbox.failed_at.is_(None),
                AlertOutbox.next_attempt_at <= func.now(),
            )
            .order_by(
                case((_SAFETY, 0), else_=1),
                case((AlertOutbox.attempts == 0, 0), else_=1),  # fresh before retries
                AlertOutbox.id,
            )
            .limit(1)
            .with_for_update(skip_locked=True)
        )
        if ids is not None:
            query = query.where(AlertOutbox.id.in_(ids))
        if not push_ok:
            query = query.where(_NEEDS_NO_PUSH)
        row = await session.scalar(query)
        if row is None:
            return None
        row.attempts += 1
        row.next_attempt_at = func.now() + LEASE
        claimed = _Claimed(
            row.id, row.key, row.kind, row.mode, row.user_id, dict(row.payload), row.attempts
        )
        await session.commit()
        return claimed


@dataclass
class _Pass:
    """One run of `deliver`: when its budget ends, and whether push failed during it."""

    deadline: float
    push_down: bool = False

    def left(self) -> float:
        return max(self.deadline - time.monotonic(), 0.0)


@dataclass(frozen=True)
class _Recipient:
    email: str | None  # the account's address now (None: the address queued, no account)
    has_app: bool


async def _recipient(sessionmaker: async_sessionmaker[AsyncSession], row: _Claimed) -> _Recipient:
    """Checks the recipient again at send time; raises _GiveUp if they may not have it now."""
    if row.user_id is None:
        return _Recipient(None, False)
    async with sessionmaker() as session:
        user = await session.get(User, row.user_id)
        if user is None or user.deactivated_at is not None:
            raise _GiveUp
        if row.payload.get("staff_only") and user.role == UserRole.STUDENT:
            raise _GiveUp
        follows = row.payload.get("follows")
        if follows is not None:
            still = await session.scalar(
                select(
                    exists().where(
                        ShareViewer.viewer_user_id == user.id,
                        ShareViewer.status == ViewerStatus.GRANTED,
                        ShareSession.id == ShareViewer.session_id,
                        ShareSession.sharer_id == uuid.UUID(follows),
                        ShareSession.status == SessionStatus.ACTIVE,
                        ShareSession.ends_at > func.now(),
                    )
                )
            )
            if not still:
                raise _GiveUp
        viewer_of = row.payload.get("viewer_of")
        if viewer_of is not None:
            granted = await session.scalar(
                select(
                    exists().where(
                        ShareViewer.viewer_user_id == user.id,
                        ShareViewer.session_id == uuid.UUID(viewer_of),
                        ShareViewer.status == ViewerStatus.GRANTED,
                    )
                )
            )
            if not granted:
                raise _GiveUp
        has_app = await session.scalar(select(exists().where(PushToken.user_id == user.id)))
        return _Recipient(user.email, bool(has_app))


def _email(row: _Claimed, to: str | None) -> Email:
    e = row.payload["email"]
    key = row.key
    if to is not None and to != e["to"]:
        # A new address is a new message: Resend refuses a key it saw with another payload.
        key = f"{row.key}:{hashlib.sha256(to.encode()).hexdigest()[:12]}"
    return Email(to or e["to"], e["subject"], e["body"], e.get("html"), idempotency_key=key)


async def _push(
    sessionmaker: async_sessionmaker[AsyncSession],
    sender: PushSender,
    row: _Claimed,
    message: PushMessage,
    run: _Pass,
) -> PushOutcome | None:
    """The push, cut off when the pass's budget ends. None (and push marked down for the rest
    of the pass) when the push service failed: an error, a timeout, or every phone failed."""
    assert row.user_id is not None
    outcome: PushOutcome | None = None
    with anyio.move_on_after(run.left()) as scope:
        try:
            outcome = await push_devices(sessionmaker, sender, row.user_id, message)
        except Exception as e:
            logger.warning("push for alert %s failed (%s)", row.id, type(e).__name__)
    if scope.cancelled_caught:
        logger.warning("push for alert %s ran past the time budget", row.id)
    if outcome is None or (outcome.failed and not outcome.accepted):
        run.push_down = True
        return None
    return outcome


async def _send(
    sessionmaker: async_sessionmaker[AsyncSession],
    sender: PushSender,
    mailer: Mailer,
    row: _Claimed,
    run: _Pass,
) -> None:
    """Delivers one alert; raises _Retry (or any error) when it should be tried again, and
    _GiveUp when it must not be sent at all."""
    to = await _recipient(sessionmaker, row)
    if row.mode is OutboxMode.EMAIL:
        await mailer.send(_email(row, to.email))
        return
    message = PushMessage.from_saved(row.payload["push"])
    # A safety message must not wait out the retries while push is down, and an alert on its
    # last try is better emailed than lost.
    fallback = row.mode is OutboxMode.PUSH_OR_EMAIL and (
        message.urgent or row.attempts >= MAX_ATTEMPTS
    )
    if row.mode is OutboxMode.PUSH_OR_EMAIL and not to.has_app:
        await mailer.send(_email(row, to.email))  # website only (e.g. an iPhone): email
        return
    outcome = None if run.push_down else await _push(sessionmaker, sender, row, message, run)
    if outcome is not None and outcome.accepted:
        return
    if outcome is None:  # the push service failed, now or earlier in this pass
        if not fallback:
            raise _Retry("push failed")
        await mailer.send(_email(row, to.email))
        return
    # Nothing failed and no phone took it: every phone gone, or muted on all of them.
    if row.mode is OutboxMode.PUSH_OR_EMAIL and message.urgent:
        # A safety message must land somewhere; urgent ones ignore muting, so no phone took
        # it.
        await mailer.send(_email(row, to.email))
    # Otherwise: muted on every phone (their choice), or every phone gone. Done.


async def _finish(
    sessionmaker: async_sessionmaker[AsyncSession],
    row: _Claimed,
    error: str | None,
    given_up: bool = False,
) -> str:
    async with sessionmaker() as session:
        if given_up:
            values: dict[str, Any] = {
                "failed_at": func.now(),
                "payload": {},
                "last_error": "recipient no longer eligible",
            }
            outcome = "dropped"
            logger.info("dropped alert %s (%s): recipient no longer eligible", row.id, row.kind)
        elif error is None:
            values = {"sent_at": func.now(), "payload": {}, "last_error": None}
            outcome = "sent"
        elif row.attempts >= MAX_ATTEMPTS:
            values = {"failed_at": func.now(), "payload": {}, "last_error": error[:200]}
            outcome = "failed"
            logger.error(
                "gave up on alert %s (%s, %s) after %d tries", row.id, row.kind, error, row.attempts
            )
        else:
            values = {
                "next_attempt_at": func.now() + backoff(row.attempts),
                "last_error": error[:200],
            }
            outcome = "retry"
        await session.execute(update(AlertOutbox).where(AlertOutbox.id == row.id).values(values))
        await session.commit()
    return outcome


@dataclass(frozen=True)
class Delivery:
    sent: int = 0
    retrying: int = 0
    failed: int = 0
    dropped: int = 0  # the recipient may no longer have it (turned off, no longer following)


async def deliver(
    sessionmaker: async_sessionmaker[AsyncSession],
    sender: PushSender | None,
    mailer: Mailer | None,
    ids: list[int] | None = None,
    budget: float = BUDGET_SECONDS,
) -> Delivery:
    """Sends due alerts (only `ids`, when given), one claimed row at a time, until none is
    due or the time budget is spent. Safe to run from several places at once. Without a
    sender or a mailer (some tests), nothing is sent: the rows wait."""
    if sender is None or mailer is None or ids == []:
        return Delivery()
    counts = {"sent": 0, "retry": 0, "failed": 0, "dropped": 0}
    run = _Pass(time.monotonic() + budget)
    while run.left() > 0:
        row = await _claim(sessionmaker, ids, push_ok=not run.push_down)
        if row is None:
            break
        error: str | None = None
        given_up = False
        try:
            await _send(sessionmaker, sender, mailer, row, run)
        except _GiveUp:
            given_up = True
        except _Retry as e:
            error = str(e)
        except Exception as e:
            # The type only: a message (or a traceback's) may quote an address or a
            # provider's answer.
            error = type(e).__name__
            logger.error("alert %s (%s, %s) failed: %s", row.id, row.kind, row.mode, error)
        counts[await _finish(sessionmaker, row, error, given_up)] += 1
    return Delivery(counts["sent"], counts["retry"], counts["failed"], counts["dropped"])


async def delete_old(session: AsyncSession) -> int:
    """Rows sent or given up on more than KEEP_DONE ago (the sweep's housekeeping)."""
    cutoff = func.now() - KEEP_DONE
    result = await session.execute(
        delete(AlertOutbox).where(or_(AlertOutbox.sent_at < cutoff, AlertOutbox.failed_at < cutoff))
    )
    return result.rowcount
