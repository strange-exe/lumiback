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
live and the contact's own viewer row is still granted, so stopping the share or revoking the
contact also stops the emails. The contact's address (outings.safe_return_email) is forgotten
as soon as the contact stops following: on return, stop, expiry, revocation, or when the
student changes their emergency email while out. Check-outs with safe return are limited per
student and per contact address (a student could otherwise use it to send mail to anyone);
the address is counted in a canonical form, so plus-aliases and case share one limit. Only
starts that happen count: a try that's refused or starts no share gives its slot back.

The watch token is derived (HMAC over the share id, with a key of its own derived from the code
pepper) rather than random, so the overdue email can carry the same link again without storing
it; only its SHA-256 is stored, like every guest token. That hash is also how the contact's
viewer row is told apart from guests who joined the share with a code.
"""

import base64
import hashlib
import hmac
import logging
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import anyio
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
# The code pepper also signs gate codes and hashes share codes: watch tokens get their own key.
WATCH_KEY_LABEL = b"lumiback/watch-token/v1"


def watch_token(session_id: uuid.UUID, pepper: str) -> str:
    key = hmac.digest(pepper.encode(), WATCH_KEY_LABEL, hashlib.sha256)
    digest = hmac.digest(key, str(session_id).encode(), hashlib.sha256)
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def watch_link(web_url: str, session_id: uuid.UUID, pepper: str) -> str:
    """The token goes after "#", which browsers never send to a server or put in logs."""
    return f"{web_url}/watch/{session_id}#key={watch_token(session_id, pepper)}"


def contact_token_hash(session_id: uuid.UUID, pepper: str) -> bytes:
    """The stored hash of the contact's viewer row on this share (see start)."""
    return hash_guest_token(watch_token(session_id, pepper))


def guest_label(user: User) -> str:
    name = (user.emergency_name or "").strip()
    return (f"{name} (emergency contact)" if name else "Emergency contact")[:40]


def canonical_address(email: str) -> str:
    """One key per inbox for the per-contact limit: lower case, without a "+tag" in the local
    part (Gmail, Outlook and most providers deliver you+anything@ to you@)."""
    local, _, domain = email.strip().lower().rpartition("@")
    return f"{local.split('+', 1)[0]}@{domain}"


@dataclass(frozen=True)
class Reservation:
    """One safe-return start counted against both limits (the recorded hits' ids)."""

    hit_ids: tuple[int, ...]


async def reserve(limiter: RateLimiter, student_id: uuid.UUID, email: str) -> Reservation | None:
    """Counts one safe-return start against both limits, atomically under the limiter's locks:
    a Reservation if both were under their limit (both are now counted), None if either was
    full (neither is counted). Called before the check-out, so a burst of parallel tries can
    never pass a limit; a try that then starts no share gives its slot back with release()."""
    try:
        ids = await limiter.hit_all(
            [
                ("safe_return:student", str(student_id), PER_STUDENT),
                ("safe_return:contact", canonical_address(email), PER_CONTACT),
            ]
        )
    except RateLimited:
        return None
    return Reservation(tuple(ids))


async def release(limiter: RateLimiter, reservation: Reservation) -> None:
    """Gives a reservation back: its check-out started no share (refused, already out, a bad
    scan, a tap-in), so it must not count against the student or the contact. Best effort: if
    this fails, the slot stays used, which only errs towards fewer emails. Shielded: it often
    runs because the request failed or was aborted, and a cancelled refund would leave the
    contact's limit used up by a request that sent nothing."""
    try:
        with anyio.CancelScope(shield=True):
            await limiter.undo(reservation.hit_ids)
    except Exception:
        logger.exception("could not release a safe return reservation")


def _contact_name(student: User, to: str) -> str | None:
    """The profile's name for the contact, only while the profile's address is still the one
    being emailed: after a change, that name belongs to someone else (the greeting is neutral)."""
    same = (student.emergency_email or "").lower() == to.lower()
    return student.emergency_name if same else None


async def _still_following(session: AsyncSession, share_id: uuid.UUID, pepper: str) -> bool:
    """Whether the contact's own viewer row on this share is still granted."""
    status = await session.scalar(
        select(ShareViewer.status).where(
            ShareViewer.session_id == share_id,
            ShareViewer.guest_token_hash == contact_token_hash(share_id, pepper),
        )
    )
    return status is ViewerStatus.GRANTED


async def forget_address(session: AsyncSession, share_ids: Iterable[uuid.UUID]) -> None:
    """The contact stops following these shares: forget their address (the caller commits)."""
    ids = list(share_ids)
    if ids:
        await session.execute(
            update(Outing)
            .where(Outing.safe_return_session_id.in_(ids), Outing.safe_return_email.is_not(None))
            .values(safe_return_email=None)
        )


async def emergency_email_changed(
    session: AsyncSession, student_id: uuid.UUID, new_email: str | None, pepper: str
) -> uuid.UUID | None:
    """The student changed or removed their emergency email: if they're out with safe return
    to another address, cut that contact off (revoke their viewer row, forget their address).
    The caller commits, then publishes AccessChanged for the returned share id."""
    outing = await session.scalar(
        select(Outing).where(
            Outing.student_id == student_id,
            Outing.returned_at.is_(None),
            Outing.safe_return_session_id.is_not(None),
            Outing.safe_return_email.is_not(None),
        )
    )
    if outing is None or outing.safe_return_session_id is None or outing.safe_return_email is None:
        return None
    if new_email is not None and new_email.lower() == outing.safe_return_email.lower():
        return None
    share_id = outing.safe_return_session_id
    await session.execute(
        update(ShareViewer)
        .where(
            ShareViewer.session_id == share_id,
            ShareViewer.guest_token_hash == contact_token_hash(share_id, pepper),
            ShareViewer.status != ViewerStatus.REVOKED,
        )
        .values(status=ViewerStatus.REVOKED, revoked_at=datetime.now(UTC))
    )
    await forget_address(session, [share_id])
    return share_id


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
            guest_token_hash=contact_token_hash(share.id, pepper),
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
        contact_name=_contact_name(student, outing.safe_return_email),
        student=student.name,
        due_at=outing.expected_return_at,
        link=watch_link(web_url, outing.safe_return_session_id, pepper),
    )


@dataclass(frozen=True)
class Back:
    """A safe-return share just ended because the student is back."""

    session_id: uuid.UUID
    email: Email | None  # None: the student had stopped sharing, so the contact isn't told


async def finish(session: AsyncSession, outing: Outing, pepper: str) -> Back | None:
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
    await forget_address(session, [share_id])
    email = None
    if (
        ended is not None
        and to
        and outing.returned_at is not None
        and await _still_following(session, share_id, pepper)
    ):
        student = await session.get(User, outing.student_id)
        if student is not None:
            email = safe_return_back_email(
                to=to,
                contact_name=_contact_name(student, to),
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
        select(Outing, User, ShareViewer.guest_token_hash)
        .join(User, User.id == Outing.student_id)
        .join(ShareSession, ShareSession.id == Outing.safe_return_session_id)
        # Granted guests of the share; the contact's row is picked out by its token hash below.
        .join(ShareViewer, ShareViewer.session_id == ShareSession.id)
        .where(
            Outing.overdue_notified_at == alerted_at,
            Outing.returned_at.is_(None),
            Outing.safe_return_email.is_not(None),
            ShareSession.status == SessionStatus.ACTIVE,
            ShareSession.ends_at > alerted_at,
            ShareViewer.status == ViewerStatus.GRANTED,
            ShareViewer.guest_token_hash.is_not(None),
        )
    )
    return [
        safe_return_overdue_email(
            to=outing.safe_return_email,
            contact_name=_contact_name(student, outing.safe_return_email),
            student=student.name,
            due_at=outing.expected_return_at,
            phone=student.phone,
            link=watch_link(web_url, outing.safe_return_session_id, pepper),
        )
        for outing, student, token_hash in rows.all()
        if outing.safe_return_email
        and outing.safe_return_session_id
        and hmac.compare_digest(
            token_hash, contact_token_hash(outing.safe_return_session_id, pepper)
        )
    ]


async def send(mailer: Mailer, email: Email | None) -> None:
    """Best effort, after the response: a failed email never undoes a check-out or return."""
    if email is None:
        return
    try:
        await mailer.send(email)
    except Exception:
        logger.exception("safe return email failed")
