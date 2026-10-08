"""Forgot password: a 6-digit code to the account's verified email, then a new password.

Built like sign-up verification: only an HMAC of the code is stored, it expires in 15 minutes,
five wrong tries kill it, and asking for one never reveals whether an account exists. Setting a
new password signs the account out everywhere.
"""

import hashlib
import hmac
import logging
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.email import Mailer
from app.email_templates import password_reset_email
from app.models import PasswordReset, RefreshToken, User
from app.security.passwords import hash_password, password_problem

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
    """Send a code if a verified account uses this email; otherwise do nothing, silently."""
    email = email.lower()
    user = await session.scalar(
        select(User).where(User.email == email, User.email_verified_at.is_not(None))
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
    session: AsyncSession, email: str, code: str, new_password: str, pepper: str
) -> User:
    """The right code sets the new password and signs every device out, in one transaction."""
    email = email.lower()
    user = await session.scalar(
        select(User).where(User.email == email, User.email_verified_at.is_not(None))
    )
    reset = await session.get(PasswordReset, user.id, with_for_update=True) if user else None
    now = datetime.now(UTC)
    if user is None or reset is None or reset.expires_at <= now or reset.attempts >= MAX_ATTEMPTS:
        await session.rollback()
        raise ResetFailed

    if not hmac.compare_digest(reset.code_hash, _hash(pepper, email, code)):
        reset.attempts += 1  # at MAX_ATTEMPTS the code is dead until a new one is requested
        await session.commit()
        raise ResetFailed

    # Checked only after the code: a weak password doesn't use up an attempt, and nobody
    # without the code learns anything about the account.
    if problem := password_problem(new_password, email=email, name=user.name):
        await session.rollback()
        raise WeakPassword(problem)

    user.password_hash = hash_password(new_password)
    await session.execute(delete(PasswordReset).where(PasswordReset.user_id == user.id))
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    await session.commit()
    return user


async def delete_expired(session: AsyncSession, now: datetime) -> int:
    result = await session.execute(delete(PasswordReset).where(PasswordReset.expires_at < now))
    return result.rowcount
