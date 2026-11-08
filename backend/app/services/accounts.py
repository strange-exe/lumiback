"""The hostel office's account controls: turn an account off and back on, correct the details it
was set up with, and cancel an invite nobody has used.

Who may do what:
- An admin (or developer): anyone (staff too), except themselves. A developer's email and
  on/off state, and deleting one, are never changed here (scripts/make_developer.py).
- A warden or head warden: the students in hostels they look after, and never their email
  address (changing it would let them take the account over with "Forgot password").
- An admin changing an email address also ends the password: the new address gets a
  set-password link (whoever set the old password may have read the old inbox).
- Cancelling an invite deletes the account, so it's admins only, like adding people.

Turning an account off keeps everything it has done (outings, scans, requests). It signs the
account out everywhere, forgets its devices' push tokens and ends its live shares; until it's
turned back on it can't sign in, refresh a session, or be sent requests to decide.

Someone deleting their own account (POST /auth/delete-account) is refused in the same cases,
and the hostel's record of their outings stays, detached from the account (`detach_records`).
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models import (
    AccountLink,
    Escalation,
    HelpRequest,
    LinkPurpose,
    Outing,
    OutingCorrection,
    OutingRequest,
    PasswordReset,
    PendingRegistration,
    RequestStatus,
    SessionStatus,
    ShareSession,
    User,
    UserRole,
)
from app.services import account_links, outbox
from app.services import sessions as shares
from app.services.admin import DEVELOPER_LOCKED, account_state, audit
from app.services.refresh_tokens import sign_out_everywhere
from app.services.staff import Staff, clear_lapsed_claims
from app.services.verification import email_allowed


class Refused(Exception):
    """A change the office can't make; `status` and the message go back to them."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


NOT_FOUND = "No such person"


def _manages(staff: Staff, target: User) -> bool:
    if staff.user.is_admin:
        return True
    return target.role == UserRole.STUDENT and staff.covers_student(target)


async def _target(session: AsyncSession, staff: Staff, user_id: uuid.UUID) -> User:
    target = await session.get(User, user_id, with_for_update=True)
    if target is None or not _manages(staff, target):
        raise Refused(404, NOT_FOUND)  # someone else's: as if they didn't exist
    if target.id == staff.user.id:
        raise Refused(403, "You can't change your own account here")
    return target


def _not_developer(target: User) -> None:
    if target.role == UserRole.DEVELOPER:
        raise Refused(403, DEVELOPER_LOCKED)


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
    _not_developer(target)
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
    # Escalations they said "I'm on it" to: nobody is any more, so the follow-up goes on.
    await clear_lapsed_claims(session)
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
    _not_developer(target)
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
) -> tuple[User, tuple[LinkPurpose, str] | None]:
    """The edited account, and the set-password link to email to its new address (when the
    email changed)."""
    target = await _target(session, staff, user_id)
    changed: list[str] = []
    link: tuple[LinkPurpose, str] | None = None
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
        if not staff.user.is_admin:
            raise Refused(403, "Only an admin can change an email address")
        _not_developer(target)
        if not email_allowed(changes.email, settings):
            domains = ", ".join(f"@{d}" for d in settings.allowed_email_domains)
            raise Refused(422, f"Use a university email address ({domains})")
        taken = await session.scalar(select(User.id).where(User.email == changes.email))
        if taken is not None:
            raise Refused(409, "Someone else already has that email address")
        changed.append(f"email {target.email} -> {changes.email}")
        # Signed out everywhere (first: it takes the user lock before any link row): a session
        # opened under the old address must not outlive it.
        await sign_out_everywhere(session, target.id)
        target.email = changes.email
        # A set-password link (or reset code) went to the old address, and whoever reads that
        # inbox could still use it: they die with it.
        await session.execute(delete(AccountLink).where(AccountLink.user_id == target.id))
        await session.execute(delete(PasswordReset).where(PasswordReset.user_id == target.id))
        # So does the password: whoever set it may have done so through the old inbox (a
        # mistyped or someone else's address). The new address gets a set-password link
        # (the caller emails it after the commit), as an admin reset does (owner, 2026-11-08).
        purpose = LinkPurpose.RESET if target.email_verified else LinkPurpose.INVITE
        target.password_hash = account_links.NO_PASSWORD
        token = await account_links.issue(
            session, target.id, purpose, settings.code_pepper.get_secret_value(), staff.user.id
        )
        link = (purpose, token)
        audit(session, staff.user, f"password:{purpose.value}", changes.email)
        # A half-finished self sign-up for the new address can never become an account now
        # (as with imports): it goes, so its code fails cleanly instead of clashing later.
        await session.execute(
            delete(PendingRegistration).where(PendingRegistration.email == changes.email.lower())
        )
    if changed:
        audit(session, staff.user, "account:edit", f"{target.email}: {', '.join(changed)}")
    try:
        await session.commit()
    except IntegrityError:  # the same address taken at the same moment
        await session.rollback()
        raise Refused(409, "Someone else already has that email address") from None
    await session.refresh(target)
    return target, link


# ---------- a student (or anyone) deleting their own account ----------

OUT_NOW = "You're out right now. Tap in or mark yourself back first, then delete your account."
ESCALATED = (
    "The hostel office is still following up your late return. "
    "Ask them to close it, then delete your account."
)
LAST_ADMIN = "Make someone else an admin first"
HELP_OPEN = (
    "The hostel office hasn't closed your Help request yet. Ask them to, then delete your account."
)


async def deletion_refused(session: AsyncSession, user: User) -> str | None:
    """Why this account can't delete itself now (None: it can), as `deactivate` refuses: while
    out, while a late escalation or a Help request is open (the office is following it up), or
    as the last admin who can sign in. Locks the account row until the caller commits: a
    tap-out at the same moment waits (its outing row references this one) and then finds the
    account gone."""
    await session.execute(select(User.id).where(User.id == user.id).with_for_update())
    out = await session.scalar(
        select(Outing.id).where(Outing.student_id == user.id, Outing.returned_at.is_(None))
    )
    if out is not None:
        return OUT_NOW
    escalated = await session.scalar(
        select(Escalation.id)
        .join(Outing, Outing.id == Escalation.outing_id)
        .where(Outing.student_id == user.id, Escalation.resolved_at.is_(None))
        .limit(1)
    )
    if escalated is not None:
        return ESCALATED
    # Its row goes with the account (ON DELETE CASCADE): the office would lose the request
    # it's answering, so it's closed first, like an escalation.
    help_open = await session.scalar(
        select(HelpRequest.id)
        .where(HelpRequest.student_id == user.id, HelpRequest.handled_at.is_(None))
        .limit(1)
    )
    if help_open is not None:
        return HELP_OPEN
    if user.role == UserRole.ADMIN and not await _another_admin_left(session, user):
        return LAST_ADMIN
    return None


async def detach_records(session: AsyncSession, user: User, now: datetime) -> None:
    """Before the account row is deleted: keep the hostel's record of this student's outings.

    Their outings (with their escalations and corrections) stay, with the name and roll no.
    as they are now, and the request each one used (the approval behind it); deleting the user
    then sets student_id to NULL on those rows. Everything else tied to the account goes with
    it through the cascades: shares and locations, contacts, devices, tokens, push tokens,
    codes, gate scans (each accepted scan's gate and time are already on its outing), and the
    requests no outing used (the student's forms, with their family's phone numbers), and
    their (handled) Help requests. Help alerts still queued for those are given up and emptied
    (they go to other people, so no cascade reaches them)."""
    helps = await session.scalars(select(HelpRequest.id).where(HelpRequest.student_id == user.id))
    await outbox.cancel(session, [f"help:{h}:" for h in helps])
    used = select(Outing.request_id).where(
        Outing.student_id == user.id, Outing.request_id.is_not(None)
    )
    await session.execute(
        delete(OutingRequest).where(
            OutingRequest.student_id == user.id, OutingRequest.id.not_in(used)
        )
    )
    # Their open questions to the office: nobody is left to tell the answer to.
    await session.execute(
        update(OutingCorrection)
        .where(
            OutingCorrection.asked_by == user.id,
            OutingCorrection.status == RequestStatus.PENDING,
        )
        .values(
            status=RequestStatus.CANCELLED,
            decided_at=now,
            note="Withdrawn: the student deleted their account.",
        )
    )
    await session.execute(
        update(Outing)
        .where(Outing.student_id == user.id)
        .values(
            student_name=user.name,
            student_roll_no=user.roll_no,
            detached_at=now,
            safe_return_email=None,  # cleared on return already; never kept past the account
        )
    )


async def cancel_invite(session: AsyncSession, staff: Staff, user_id: uuid.UUID) -> str:
    """Deletes an imported account nobody has set up yet. Returns its email. Commits."""
    if not staff.user.is_admin:
        raise Refused(403, "Admins only")
    target = await _target(session, staff, user_id)
    _not_developer(target)
    if target.email_verified_at is not None:
        raise Refused(409, "They've already set up their account. Turn it off instead.")
    email = target.email
    await session.delete(target)
    audit(session, staff.user, "invite:cancel", email)
    await session.commit()
    return email
