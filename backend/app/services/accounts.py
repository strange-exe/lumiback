"""The hostel office's account controls: turn an account off and back on, correct the details it
was set up with, and cancel an invite nobody has used.

Who may do what:
- An admin: anyone (staff too), except themselves.
- A warden or head warden: the students in hostels they look after, and never their email
  address (changing it would let them take the account over with "Forgot password").
- Cancelling an invite deletes the account, so it's admins only, like adding people.

Turning an account off keeps everything it has done (outings, scans, requests). It signs the
account out everywhere, forgets its devices' push tokens and ends its live shares; until it's
turned back on it can't sign in, refresh a session, or be sent requests to decide.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models import (
    AccountLink,
    Outing,
    PasswordReset,
    SessionStatus,
    ShareSession,
    User,
    UserRole,
)
from app.services import sessions as shares
from app.services.admin import account_state, audit
from app.services.refresh_tokens import sign_out_everywhere
from app.services.staff import Staff
from app.services.verification import email_allowed


class Refused(Exception):
    """A change the office can't make; `status` and the message go back to them."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


NOT_FOUND = "No such person"


def _manages(staff: Staff, target: User) -> bool:
    if staff.user.role == UserRole.ADMIN:
        return True
    return target.role == UserRole.STUDENT and staff.covers_student(target)


async def _target(session: AsyncSession, staff: Staff, user_id: uuid.UUID) -> User:
    target = await session.get(User, user_id, with_for_update=True)
    if target is None or not _manages(staff, target):
        raise Refused(404, NOT_FOUND)  # someone else's: as if they didn't exist
    if target.id == staff.user.id:
        raise Refused(403, "You can't change your own account here")
    return target


async def _another_admin_left(session: AsyncSession, target: User) -> bool:
    """Locks the admin rows while counting, like set_role: two admins turning each other off at
    the same moment must not leave nobody who can sign in."""
    admins = list(
        await session.scalars(select(User).where(User.role == UserRole.ADMIN).with_for_update())
    )
    return any(a.id != target.id and account_state(a) == "active" for a in admins)


async def deactivate(session: AsyncSession, staff: Staff, user_id: uuid.UUID) -> list[uuid.UUID]:
    """Turns the account off. Returns the live shares it ended (to tell open streams).
    Commits."""
    target = await _target(session, staff, user_id)
    if target.deactivated_at is not None:
        await session.commit()
        return []
    if target.role == UserRole.ADMIN and not await _another_admin_left(session, target):
        raise Refused(409, "Make someone else an admin first")
    out = await session.scalar(
        select(Outing.id).where(Outing.student_id == target.id, Outing.returned_at.is_(None))
    )
    if out is not None:
        raise Refused(409, "They're out right now. Record their return first, then turn it off.")
    now = datetime.now(UTC)
    target.deactivated_at = now
    await sign_out_everywhere(session, target.id, now)  # tokens and push tokens
    # And no way back in: a set-password link or reset code already out dies too.
    await session.execute(delete(AccountLink).where(AccountLink.user_id == target.id))
    await session.execute(delete(PasswordReset).where(PasswordReset.user_id == target.id))
    live = list(
        await session.scalars(
            select(ShareSession.id).where(
                ShareSession.sharer_id == target.id, ShareSession.status == SessionStatus.ACTIVE
            )
        )
    )
    audit(session, staff.user, "account:off", target.email)
    await session.commit()
    for share_id in live:
        await shares.end(session, share_id, status=SessionStatus.ENDED, reason="account_off")
    return live


async def reactivate(session: AsyncSession, staff: Staff, user_id: uuid.UUID) -> None:
    target = await _target(session, staff, user_id)
    if target.deactivated_at is not None:
        target.deactivated_at = None
        audit(session, staff.user, "account:on", target.email)
    await session.commit()


@dataclass
class Changes:
    """Only the fields sent are changed; `roll_no` None clears it."""

    name: str | None = None
    email: str | None = None
    phone: str | None = None
    roll_no: str | None = None
    roll_no_sent: bool = False
    phone_sent: bool = False


async def edit(
    session: AsyncSession, staff: Staff, user_id: uuid.UUID, changes: Changes, settings: Settings
) -> User:
    target = await _target(session, staff, user_id)
    changed: list[str] = []
    if changes.name is not None and changes.name != target.name:
        target.name = changes.name
        changed.append("name")
    if changes.roll_no_sent and changes.roll_no != target.roll_no:
        target.roll_no = changes.roll_no
        changed.append("roll no")
    if changes.phone_sent and changes.phone != target.phone:
        target.phone = changes.phone
        changed.append("phone")
    if changes.email is not None and changes.email != target.email:
        if staff.user.role != UserRole.ADMIN:
            raise Refused(403, "Only an admin can change an email address")
        if not email_allowed(changes.email, settings):
            domains = ", ".join(f"@{d}" for d in settings.allowed_email_domains)
            raise Refused(422, f"Use a university email address ({domains})")
        taken = await session.scalar(select(User.id).where(User.email == changes.email))
        if taken is not None:
            raise Refused(409, "Someone else already has that email address")
        changed.append(f"email {target.email} -> {changes.email}")
        target.email = changes.email
        # A set-password link (or reset code) went to the old address, and whoever reads that
        # inbox could still use it: they die with it. The office sends a new link if needed.
        await session.execute(delete(AccountLink).where(AccountLink.user_id == target.id))
        await session.execute(delete(PasswordReset).where(PasswordReset.user_id == target.id))
    if changed:
        audit(session, staff.user, "account:edit", f"{target.email}: {', '.join(changed)}")
    try:
        await session.commit()
    except IntegrityError:  # the same address taken at the same moment
        await session.rollback()
        raise Refused(409, "Someone else already has that email address") from None
    await session.refresh(target)
    return target


async def cancel_invite(session: AsyncSession, staff: Staff, user_id: uuid.UUID) -> str:
    """Deletes an imported account nobody has set up yet. Returns its email. Commits."""
    if staff.user.role != UserRole.ADMIN:
        raise Refused(403, "Admins only")
    target = await _target(session, staff, user_id)
    if target.email_verified_at is not None:
        raise Refused(409, "They've already set up their account. Turn it off instead.")
    email = target.email
    await session.delete(target)
    audit(session, staff.user, "invite:cancel", email)
    await session.commit()
    return email
