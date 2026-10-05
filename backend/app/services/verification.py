"""Email ownership: allowed domains and 6-digit verification codes."""

import hashlib
import hmac
import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.email import Email, Mailer
from app.models import EmailVerification, User

logger = logging.getLogger(__name__)

CODE_TTL = timedelta(minutes=15)
MAX_ATTEMPTS = 5


class VerificationFailed(Exception):
    """Unknown email, no/expired code, too many attempts, or wrong code (indistinguishable)."""


def email_allowed(email: str, settings: Settings) -> bool:
    return email.rsplit("@", 1)[-1].lower() in settings.allowed_email_domains


def _hash(pepper: str, user_id: uuid.UUID, code: str) -> bytes:
    # Bound to the user: the same 6 digits hash differently for every account.
    return hmac.new(pepper.encode(), f"{user_id}:{code}".encode(), hashlib.sha256).digest()


async def issue(session: AsyncSession, user: User, pepper: str, mailer: Mailer) -> None:
    """Replace any previous code with a fresh one and email it."""
    code = f"{secrets.randbelow(10**6):06d}"
    expires_at = datetime.now(UTC) + CODE_TTL
    values = {"code_hash": _hash(pepper, user.id, code), "attempts": 0, "expires_at": expires_at}
    await session.execute(
        insert(EmailVerification)
        .values(user_id=user.id, **values)
        .on_conflict_do_update(
            index_elements=["user_id"], set_={**values, "created_at": func.now()}
        )
    )
    await session.commit()
    try:
        await mailer.send(
            Email(
                to=user.email,
                subject="Your Outing verification code",
                body=(
                    f"Hi {user.name},\n\n"
                    f"Your Outing verification code is {code}.\n"
                    f"It expires in {int(CODE_TTL.total_seconds() // 60)} minutes.\n\n"
                    "If you did not create an Outing account, you can ignore this email.\n"
                ),
            )
        )
    except Exception:
        # The account exists either way; the student can ask for a new code.
        logger.exception("could not send verification email")


async def verify(session: AsyncSession, email: str, code: str, pepper: str) -> User:
    user = (
        await session.execute(select(User).where(User.email == email.lower()))
    ).scalar_one_or_none()
    if user is None:
        raise VerificationFailed
    if user.email_verified:
        return user  # idempotent

    pending = await session.get(EmailVerification, user.id, with_for_update=True)
    now = datetime.now(UTC)
    if pending is None or pending.expires_at <= now or pending.attempts >= MAX_ATTEMPTS:
        await session.rollback()
        raise VerificationFailed

    if not hmac.compare_digest(pending.code_hash, _hash(pepper, user.id, code)):
        pending.attempts += 1
        if pending.attempts >= MAX_ATTEMPTS:
            await session.delete(pending)  # burned: the student must request a new code
        await session.commit()
        raise VerificationFailed

    user.email_verified_at = now
    await session.execute(delete(EmailVerification).where(EmailVerification.user_id == user.id))
    await session.commit()
    return user
