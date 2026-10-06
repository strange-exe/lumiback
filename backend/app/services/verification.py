"""Sign-up with email ownership proof: allowed domains, pending registrations, 6-digit codes.

No user row exists until the student enters the code sent to their inbox. Until then the
sign-up lives in pending_registrations, which expires and is swept away.
"""

import hashlib
import hmac
import logging
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.email import Mailer
from app.email_templates import verification_email
from app.models import PendingRegistration, User
from app.schemas import RegisterIn
from app.security.passwords import hash_password

logger = logging.getLogger(__name__)

CODE_TTL = timedelta(minutes=15)
MAX_ATTEMPTS = 5


class AlreadyRegistered(Exception):
    """A verified account already uses this email."""


class EmailNotSent(Exception):
    """The email provider refused or could not be reached; the student should try again."""


class VerificationFailed(Exception):
    """No pending sign-up, expired, too many attempts, or wrong code (indistinguishable)."""


def email_allowed(email: str, settings: Settings) -> bool:
    return email.rsplit("@", 1)[-1].lower() in settings.allowed_email_domains


def _hash(pepper: str, email: str, code: str) -> bytes:
    # Bound to the address: the same 6 digits hash differently for every sign-up.
    return hmac.new(pepper.encode(), f"{email}:{code}".encode(), hashlib.sha256).digest()


def _new_code() -> str:
    return f"{secrets.randbelow(10**6):06d}"


async def _send_code(mailer: Mailer, email: str, name: str, code: str) -> None:
    try:
        await mailer.send(
            verification_email(
                to=email, name=name, code=code, minutes=int(CODE_TTL.total_seconds() // 60)
            )
        )
    except Exception as e:
        logger.exception("could not send verification email")
        raise EmailNotSent from e


async def start(session: AsyncSession, body: RegisterIn, pepper: str, mailer: Mailer) -> None:
    """Create or replace the pending sign-up for this email, and send it a fresh code."""
    exists = await session.scalar(select(User.id).where(User.email == body.email))
    if exists is not None:
        raise AlreadyRegistered
    code = _new_code()
    values = {
        "name": body.name,
        "roll_no": body.roll_no,
        "password_hash": hash_password(body.password),
        "code_hash": _hash(pepper, body.email, code),
        "attempts": 0,
        "expires_at": datetime.now(UTC) + CODE_TTL,
    }
    # Replacing (not refusing) a pending sign-up means nobody can lock an address they don't own:
    # whoever reads the inbox gets the newest code.
    await session.execute(
        insert(PendingRegistration)
        .values(email=body.email, **values)
        .on_conflict_do_update(index_elements=["email"], set_={**values, "created_at": func.now()})
    )
    await session.commit()
    await _send_code(mailer, body.email, body.name, code)


async def resend(session: AsyncSession, email: str, pepper: str, mailer: Mailer) -> None:
    """New code for a pending sign-up. Silently does nothing if there is none."""
    pending = await session.get(PendingRegistration, email, with_for_update=True)
    if pending is None:
        await session.rollback()
        return
    code = _new_code()
    pending.code_hash = _hash(pepper, email, code)
    pending.attempts = 0
    pending.expires_at = datetime.now(UTC) + CODE_TTL
    await session.commit()
    await _send_code(mailer, email, pending.name, code)


async def verify(session: AsyncSession, email: str, code: str, pepper: str) -> User:
    """The right code turns the pending sign-up into a verified user, in one transaction."""
    email = email.lower()
    pending = await session.get(PendingRegistration, email, with_for_update=True)
    now = datetime.now(UTC)
    if pending is None or pending.expires_at <= now or pending.attempts >= MAX_ATTEMPTS:
        await session.rollback()
        raise VerificationFailed

    if not hmac.compare_digest(pending.code_hash, _hash(pepper, email, code)):
        pending.attempts += 1  # at MAX_ATTEMPTS the code is dead until a new one is sent
        await session.commit()
        raise VerificationFailed

    user = User(
        name=pending.name,
        email=email,
        password_hash=pending.password_hash,
        roll_no=pending.roll_no,
        email_verified_at=now,
    )
    session.add(user)
    await session.execute(delete(PendingRegistration).where(PendingRegistration.email == email))
    try:
        await session.commit()
    except IntegrityError:
        # Someone verified this address a moment ago; this sign-up is moot.
        await session.rollback()
        raise VerificationFailed from None
    await session.refresh(user)
    return user


async def delete_expired(session: AsyncSession, now: datetime) -> int:
    result = await session.execute(
        delete(PendingRegistration).where(PendingRegistration.expires_at < now)
    )
    return result.rowcount
