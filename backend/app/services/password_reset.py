"""Forgot password: a 6-digit code to the account's verified email, then a new password.

Built like sign-up verification: only an HMAC of the code is stored, it expires in 15 minutes,
five wrong tries kill it, and asking for one never reveals whether an account exists. Setting a
new password signs the account out everywhere.
"""

import hashlib
import hmac
import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.email import Mailer
from app.email_templates import password_reset_email
from app.models import AccountLink, PasswordReset, User
from app.security.breached import BREACHED, BreachChecker
from app.security.passwords import hash_password_async, password_problem, verify_password_async
from app.services.refresh_tokens import (
    is_live,
    lock_user,
    sign_out_all_but,
    sign_out_everywhere,
)

logger = logging.getLogger(__name__)

CODE_TTL = timedelta(minutes=15)
MAX_ATTEMPTS = 5


class EmailNotSent(Exception):
    """The email provider refused or could not be reached; the student should try again."""


class ResetFailed(Exception):
    """No code, expired, too many attempts, or wrong code (indistinguishable to the caller)."""


class WeakPassword(Exception):
    def __init__(self, problem: str) -> None:
        super().__init__(problem)
        self.problem = problem


def _hash(pepper: str, email: str, code: str) -> bytes:
    # "reset:" keeps these from ever matching a sign-up code for the same address.
    return hmac.new(pepper.encode(), f"reset:{email}:{code}".encode(), hashlib.sha256).digest()


async def start(session: AsyncSession, email: str, pepper: str, mailer: Mailer) -> None:
    """Send a code if a verified account that's on uses this email; otherwise do nothing,
    silently (a turned-off account gets no code: it couldn't sign in with the new password)."""
    email = email.lower()
    user = await session.scalar(
        select(User).where(
            User.email == email,
            User.email_verified_at.is_not(None),
            User.deactivated_at.is_(None),
        )
    )
    if user is None:
        return
    code = f"{secrets.randbelow(10**6):06d}"
    values = {
        "code_hash": _hash(pepper, email, code),
        "attempts": 0,
        "expires_at": datetime.now(UTC) + CODE_TTL,
    }
    # A newer request replaces the older code, so only the latest email works.
    await session.execute(
        insert(PasswordReset)
        .values(user_id=user.id, **values)
        .on_conflict_do_update(
            index_elements=["user_id"], set_={**values, "created_at": func.now()}
        )
    )
    await session.commit()
    try:
        await mailer.send(
            password_reset_email(
                to=email, name=user.name, code=code, minutes=int(CODE_TTL.total_seconds() // 60)
            )
        )
    except Exception as e:
        logger.exception("could not send password reset email")
        raise EmailNotSent from e


async def finish(
    session: AsyncSession,
    email: str,
    code: str,
    new_password: str,
    pepper: str,
    breaches: BreachChecker,
) -> User:
    """The right code sets the new password and signs every device out, in one transaction.

    Three steps, so the reset row is never locked across the breached-password lookup (a
    network call of up to 2 s): (1) under the row lock, check the code and count a wrong one;
    (2) with no lock, check the new password; (3) under the lock again, re-check that the same
    code is still live, then save. Step 3 deletes the row, so a code works only once."""
    email = email.lower()
    code_hash = _hash(pepper, email, code)
    user = await _check_code(session, email, code_hash)

    # Checked only after the code: a weak password doesn't use up an attempt, and nobody
    # without the code learns anything about the account.
    problem = password_problem(new_password, email=email, name=user.name)
    if problem is None and await breaches.is_breached(new_password):
        problem = BREACHED
    if problem:
        raise WeakPassword(problem)
    new_hash = await hash_password_async(new_password)  # argon2, slow: outside the lock too

    # A newer request may have replaced the code, or a parallel reset used it, meanwhile.
    await lock_user(session, user.id)  # first, like every password change: see lock_user
    reset = await session.get(PasswordReset, user.id, with_for_update=True, populate_existing=True)
    now = datetime.now(UTC)
    if (
        reset is None
        or reset.expires_at <= now
        or reset.attempts >= MAX_ATTEMPTS
        or not hmac.compare_digest(reset.code_hash, code_hash)
    ):
        await session.rollback()
        raise ResetFailed
    user.password_hash = new_hash
    await session.execute(delete(PasswordReset).where(PasswordReset.user_id == user.id))
    # An admin's set-password link, if one is out, would otherwise replace this password.
    await session.execute(delete(AccountLink).where(AccountLink.user_id == user.id))
    await sign_out_everywhere(session, user.id, now)  # a lost phone stops here too
    await session.commit()
    return user


class WrongPassword(Exception):
    """The current password given to change it isn't right (or stopped being right while the
    change was being checked: a reset or another change got there first)."""


class SignedOut(Exception):
    """The sign-in asking for the change was signed out while it was being checked."""


async def change(
    session: AsyncSession,
    user: User,
    current_password: str,
    new_password: str,
    breaches: BreachChecker,
    keep: uuid.UUID | None,
) -> int:
    """A signed-in person changes their password, knowing the current one. Every other device
    is signed out (a lost phone stops here), and this one (`keep`) stays signed in; with no
    `keep` (a sign-in from before devices had ids) every device is. Any reset code or admin
    link still out stops working. Returns how many devices were signed out. Commits.

    Argon2 runs off the event loop and no transaction is open across the breached-password
    lookup (a network call); under the user lock, the password and the sign-in are checked
    again, so a reset that lands meanwhile wins."""
    checked = user.password_hash
    await session.commit()  # nothing to save yet; no transaction held across what follows
    if not await verify_password_async(checked, current_password):
        raise WrongPassword
    problem = password_problem(new_password, email=user.email, name=user.name)
    if problem is None and new_password == current_password:
        problem = "must be different from your current one"
    if problem is None and await breaches.is_breached(new_password):
        problem = BREACHED
    if problem:
        raise WeakPassword(problem)
    new_hash = await hash_password_async(new_password)  # before taking any lock

    await lock_user(session, user.id)
    fresh = await session.get(User, user.id, populate_existing=True)
    if fresh is None or fresh.password_hash != checked:
        await session.rollback()
        raise WrongPassword
    if keep is not None and not await is_live(session, user.id, keep):
        await session.rollback()
        raise SignedOut
    user = fresh
    signed_out = await sign_out_all_but(session, user.id, keep)
    user.password_hash = new_hash
    await session.execute(delete(PasswordReset).where(PasswordReset.user_id == user.id))
    await session.execute(delete(AccountLink).where(AccountLink.user_id == user.id))
    await session.commit()
    return signed_out


async def _check_code(session: AsyncSession, email: str, code_hash: bytes) -> User:
    """Step 1 of finish: the user whose live code this is (raises ResetFailed otherwise). Ends
    its transaction either way, so no lock is held after it returns."""
    user = await session.scalar(
        select(User).where(User.email == email, User.email_verified_at.is_not(None))
    )
    reset = await session.get(PasswordReset, user.id, with_for_update=True) if user else None
    now = datetime.now(UTC)
    if user is None or reset is None or reset.expires_at <= now or reset.attempts >= MAX_ATTEMPTS:
        await session.rollback()
        raise ResetFailed
    if not hmac.compare_digest(reset.code_hash, code_hash):
        reset.attempts += 1  # at MAX_ATTEMPTS the code is dead until a new one is requested
        await session.commit()
        raise ResetFailed
    await session.commit()  # releases the row lock; nothing changed
    return user


async def delete_expired(session: AsyncSession, now: datetime) -> int:
    result = await session.execute(delete(PasswordReset).where(PasswordReset.expires_at < now))
    return result.rowcount
