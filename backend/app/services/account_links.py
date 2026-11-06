"""One-time "set your password" links that an admin sends: for imported students (invite) and
for an admin password reset (reset).

No password is ever emailed. The link carries a random 256-bit token in the URL fragment
(never sent to a server log or in a Referer); only HMAC(CODE_PEPPER, "link:" token) is stored.
A link works once, expires (INVITE_TTL / RESET_TTL), and a newer link for the same account
replaces the older one. Using it sets the password, verifies the email (the student proved
they read the inbox), and signs the account out everywhere.
"""

import hashlib
import hmac
import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.email import Mailer
from app.email_templates import account_link_email
from app.models import AccountLink, LinkPurpose, PasswordReset, User
from app.security.breached import BREACHED, BreachChecker
from app.security.passwords import hash_password_async, password_problem
from app.services.refresh_tokens import lock_user, sign_out_everywhere

logger = logging.getLogger(__name__)

INVITE_TTL = timedelta(days=7)  # imported in bulk: students may not read email for days
RESET_TTL = timedelta(hours=24)
TTL = {LinkPurpose.INVITE: INVITE_TTL, LinkPurpose.RESET: RESET_TTL}

# Stored for accounts that have no password yet (imported) or had theirs reset by an admin.
# Not an Argon2 hash, so no password can ever match it (verify_password returns False).
NO_PASSWORD = "!no-password"  # noqa: S105 (a marker that matches no password, not a secret)


class LinkFailed(Exception):
    """No such link, used, replaced or expired (indistinguishable to the caller)."""


class WeakPassword(Exception):
    def __init__(self, problem: str) -> None:
        super().__init__(problem)
        self.problem = problem


class EmailNotSent(Exception):
    """The link was saved but its email could not be sent: send it again."""


def _hash(pepper: str, token: str) -> bytes:
    # "link:" keeps these from ever matching a sign-up or reset code hash.
    return hmac.new(pepper.encode(), f"link:{token}".encode(), hashlib.sha256).digest()


def has_password(user: User) -> bool:
    return user.password_hash != NO_PASSWORD


def url(web_url: str, token: str) -> str:
    return f"{web_url}/set-password#t={token}"


async def issue(
    session: AsyncSession,
    user_id: uuid.UUID,
    purpose: LinkPurpose,
    pepper: str,
    created_by: uuid.UUID | None,
) -> str:
    """Saves a new link for this account (replacing any older one) and returns its token.
    The caller commits, then emails it."""
    token = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    values = {
        "purpose": purpose,
        "token_hash": _hash(pepper, token),
        "expires_at": now + TTL[purpose],
        "created_by": created_by,
        "sent_at": None,
        "created_at": now,
    }
    await session.execute(
        insert(AccountLink)
        .values(user_id=user_id, **values)
        .on_conflict_do_update(index_elements=["user_id"], set_=values)
    )
    return token


async def send(
    session: AsyncSession,
    mailer: Mailer,
    *,
    user_id: uuid.UUID,
    to: str,
    name: str,
    purpose: LinkPurpose,
    token: str,
    web_url: str,
    pepper: str,
) -> None:
    """Emails a saved link and records when it went (only if it is still the live link)."""
    try:
        await mailer.send(
            account_link_email(
                to=to, name=name, invite=purpose is LinkPurpose.INVITE, link=url(web_url, token)
            )
        )
    except Exception as e:
        logger.exception("could not send a set-password link")
        raise EmailNotSent from e
    await session.execute(
        update(AccountLink)
        .where(AccountLink.user_id == user_id, AccountLink.token_hash == _hash(pepper, token))
        .values(sent_at=datetime.now(UTC))
    )
    await session.commit()


async def reset(
    session: AsyncSession, user: User, pepper: str, created_by: uuid.UUID
) -> tuple[LinkPurpose, str]:
    """An admin's password reset. A student who never set a password gets a fresh invite;
    otherwise the old password stops working now and every device is signed out. Commits."""
    # A verified account is a reset even if its password was already reset (a second link).
    purpose = LinkPurpose.RESET if user.email_verified else LinkPurpose.INVITE
    if purpose is LinkPurpose.RESET:
        user.password_hash = NO_PASSWORD
        await sign_out_everywhere(session, user.id, datetime.now(UTC))
    token = await issue(session, user.id, purpose, pepper, created_by)
    await session.commit()
    return purpose, token


async def peek(session: AsyncSession, token: str, pepper: str) -> User:
    """The account a live link belongs to (raises LinkFailed). Takes no lock."""
    link = await session.scalar(
        select(AccountLink).where(AccountLink.token_hash == _hash(pepper, token))
    )
    if link is None or link.expires_at <= datetime.now(UTC):
        await session.rollback()
        raise LinkFailed
    user = await session.get(User, link.user_id)
    await session.commit()
    if user is None:
        raise LinkFailed
    return user


async def finish(
    session: AsyncSession, token: str, new_password: str, pepper: str, breaches: BreachChecker
) -> User:
    """Sets the password with a live link, in one transaction; the link then stops working.

    Like password_reset.finish, the breached-password lookup (a network call) runs with no
    row lock held, and the link is re-checked under the lock before saving."""
    user = await peek(session, token, pepper)
    problem = password_problem(new_password, email=user.email, name=user.name)
    if problem is None and await breaches.is_breached(new_password):
        problem = BREACHED
    if problem:
        raise WeakPassword(problem)
    new_hash = await hash_password_async(new_password)  # argon2, slow: outside the lock too

    token_hash = _hash(pepper, token)
    now = datetime.now(UTC)
    await lock_user(session, user.id)  # first, like every password change: see lock_user
    link = await session.get(AccountLink, user.id, with_for_update=True, populate_existing=True)
    if (
        link is None
        or link.expires_at <= now
        or not hmac.compare_digest(link.token_hash, token_hash)
    ):
        await session.rollback()
        raise LinkFailed
    user = await session.get(User, link.user_id, populate_existing=True)
    if user is None:
        await session.rollback()
        raise LinkFailed
    user.password_hash = new_hash
    if user.email_verified_at is None:
        user.email_verified_at = now  # the link reached their inbox
    await session.execute(delete(AccountLink).where(AccountLink.user_id == user.id))
    await session.execute(delete(PasswordReset).where(PasswordReset.user_id == user.id))
    await sign_out_everywhere(session, user.id, now)
    await session.commit()
    await session.refresh(user)
    return user


async def delete_expired(session: AsyncSession, now: datetime) -> int:
    result = await session.execute(delete(AccountLink).where(AccountLink.expires_at < now))
    return result.rowcount
