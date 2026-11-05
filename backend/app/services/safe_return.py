"""Safe return: a student's emergency contact follows one outing until the student is back.

Consent: the student ticks "Let my emergency contact follow until I'm back" at check-out (in
the app, on the website, or with the gate scan). That tick is the approval, so the contact's
viewer row starts granted; no second approval is asked for. The contact needs no account.

What is created, in the check-out's own transaction:
- an outing-linked share (source "outing", ends "until_return"), and
- one guest viewer for the contact, whose token is emailed as a watch link.

The link works only while the share is live: it ends when the student is back (self-reported
or at the gate), when the student stops sharing, or at the latest LIVE_AFTER_DUE past the return
time. Location is sent only while the student shares from the app or the website, like any
share; every view the contact makes is in the share's access log, like any viewer's.

Emails (plain text, see app/email_templates.py), at most three per outing and each once:
the link at check-out, a note if the student is 30 min late (when the student's own late alert
fires), and "back safely" on return. Overdue and back emails go only while the share is still
live, so stopping the share also stops the emails. Check-outs with safe return are limited per
student and per contact address (a student could otherwise use it to send mail to anyone).

The watch token is derived (HMAC with the code pepper, over the share id) rather than random,
so the overdue email can carry the same link again without storing it; only its SHA-256 is
stored, like every guest token.
"""

import base64
import hashlib
import hmac
import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.email import Email, Mailer
from app.email_templates import (
    safe_return_back_email,
    safe_return_overdue_email,
    safe_return_start_email,
)
from app.models import (
    EndsWhen,
    Location,
    Outing,
    SessionStatus,
    ShareSession,
    ShareSource,
    ShareViewer,
    User,
    ViewerStatus,
)
from app.security.codes import hash_guest_token
from app.security.rate_limit import Limit, RateLimited, RateLimiter

logger = logging.getLogger(__name__)

# A student who's very late is when the contact needs the link most; this only bounds a share
# whose student never checks back in.
LIVE_AFTER_DUE = timedelta(hours=12)
# Each check-out with safe return sends one email; a few outings a day is plenty.
PER_STUDENT = Limit(max_hits=5, window_seconds=24 * 3600)
PER_CONTACT = Limit(max_hits=5, window_seconds=24 * 3600)
RETURNED = "returned"  # the share's ended_reason when the student is back


def watch_token(session_id: uuid.UUID, pepper: str) -> str:
    digest = hmac.new(pepper.encode(), f"safe-return:{session_id}".encode(), hashlib.sha256)
    return base64.urlsafe_b64encode(digest.digest()).rstrip(b"=").decode()


def watch_link(web_url: str, session_id: uuid.UUID, pepper: str) -> str:
    """The token goes after "#", which browsers never send to a server or put in logs."""
    return f"{web_url}/watch/{session_id}#key={watch_token(session_id, pepper)}"


def guest_label(user: User) -> str:
    name = (user.emergency_name or "").strip()
    return (f"{name} (emergency contact)" if name else "Emergency contact")[:40]


async def allowed(limiter: RateLimiter, user: User) -> bool:
    """Whether a safe-return email may go out for this student now (nothing is recorded)."""
    if not user.emergency_email:
        return False
    try:
        await limiter.check("safe_return:student", str(user.id), PER_STUDENT)
        await limiter.check("safe_return:contact", user.emergency_email, PER_CONTACT)
    except RateLimited:
        return False
    return True


async def record(limiter: RateLimiter, user_id: uuid.UUID, email: str) -> None:
    await limiter.record("safe_return:student", str(user_id))
    await limiter.record("safe_return:contact", email)


async def start(
    session: AsyncSession, outing: Outing, student: User, pepper: str
) -> ShareSession | None:
    """Adds the outing-linked share and the contact's viewer for an outing not yet added to the
    session (the caller adds and commits it, so all three are saved together or not at all).
    None when the student has no emergency email."""
    if not student.emergency_email:
        return None
    now = datetime.now(UTC)
    share = ShareSession(
        id=uuid.uuid4(),  # known before the insert: the watch token is derived from it
        sharer_id=student.id,
        source=ShareSource.OUTING,
        ends_when=EndsWhen.UNTIL_RETURN,
        ends_at=outing.expected_return_at + LIVE_AFTER_DUE,
    )
    session.add(share)
    # Rows go in parent first: with no ORM relationships, a single flush wouldn't order them.
    await session.flush()
    session.add(
        ShareViewer(
            session_id=share.id,
            guest_label=guest_label(student),
            guest_token_hash=hash_guest_token(watch_token(share.id, pepper)),
            status=ViewerStatus.GRANTED,  # the tick at check-out is the student's approval
            granted_at=now,
        )
    )
    outing.safe_return_session_id = share.id
    outing.safe_return_email = student.emergency_email
    return share


def start_email(outing: Outing, student: User, web_url: str, pepper: str) -> Email | None:
    if outing.safe_return_session_id is None or outing.safe_return_email is None:
        return None
    return safe_return_start_email(
        to=outing.safe_return_email,
        contact_name=student.emergency_name,
        student=student.name,
        due_at=outing.expected_return_at,
        link=watch_link(web_url, outing.safe_return_session_id, pepper),
    )


@dataclass(frozen=True)
class Back:
    """A safe-return share just ended because the student is back."""

    session_id: uuid.UUID
    email: Email | None  # None: the student had stopped sharing, so the contact isn't told


async def finish(session: AsyncSession, outing: Outing) -> Back | None:
    """On return (the caller commits): ends the outing's share, deletes its location, and
    forgets the contact's address. Publish AccessChanged(session_id) after the commit."""
    if outing.safe_return_session_id is None:
        return None
    share_id = outing.safe_return_session_id
    ended = (
        await session.execute(
            update(ShareSession)
            .where(ShareSession.id == share_id, ShareSession.status == SessionStatus.ACTIVE)
            .values(status=SessionStatus.ENDED, ended_at=datetime.now(UTC), ended_reason=RETURNED)
            .returning(ShareSession.id)
        )
    ).scalar_one_or_none()
    await session.execute(delete(Location).where(Location.session_id == share_id))
    to = outing.safe_return_email
    await session.execute(
        update(Outing).where(Outing.id == outing.id).values(safe_return_email=None)
    )
    email = None
    if ended is not None and to and outing.returned_at is not None:
        student = await session.get(User, outing.student_id)
        if student is not None:
            email = safe_return_back_email(
                to=to,
                contact_name=student.emergency_name,
                student=student.name,
                returned_at=outing.returned_at,
            )
    return Back(share_id, email)


async def overdue_emails(
    session: AsyncSession, alerted_at: datetime, web_url: str, pepper: str
) -> list[Email]:
    """For outings whose late alert was marked at `alerted_at` (this sweep): one email to each
    contact still following. The alert is marked once per outing, so this is sent once."""
    rows = await session.execute(
        select(Outing, User)
        .join(User, User.id == Outing.student_id)
        .join(ShareSession, ShareSession.id == Outing.safe_return_session_id)
        .where(
            Outing.overdue_notified_at == alerted_at,
            Outing.returned_at.is_(None),
            Outing.safe_return_email.is_not(None),
            ShareSession.status == SessionStatus.ACTIVE,
            ShareSession.ends_at > alerted_at,
        )
    )
    return [
        safe_return_overdue_email(
            to=outing.safe_return_email,
            contact_name=student.emergency_name,
            student=student.name,
            due_at=outing.expected_return_at,
            phone=student.phone,
            link=watch_link(web_url, outing.safe_return_session_id, pepper),
        )
        for outing, student in rows.all()
        if outing.safe_return_email and outing.safe_return_session_id
    ]


async def send(mailer: Mailer, email: Email | None) -> None:
    """Best effort, after the response: a failed email never undoes a check-out or return."""
    if email is None:
        return
    try:
        await mailer.send(email)
    except Exception:
        logger.exception("safe return email failed")
