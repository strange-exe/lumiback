"""Refresh-token lifecycle: issue, rotate (with reuse detection), revoke.

Every login starts a *family*. Each refresh atomically retires the presented token and issues
a successor in the same family. If a retired token is ever presented again, someone holds a copy
(theft or replay), so the whole family is revoked and every holder must log in again.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import RefreshToken
from app.security.tokens import REFRESH_TTL, InvalidToken, hash_refresh_token, new_refresh_token


async def issue(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    family_id: uuid.UUID | None = None,
    now: datetime | None = None,
) -> str:
    now = now or datetime.now(UTC)
    plaintext, digest = new_refresh_token()
    session.add(
        RefreshToken(
            user_id=user_id,
            token_hash=digest,
            family_id=family_id or uuid.uuid4(),
            expires_at=now + REFRESH_TTL,
        )
    )
    return plaintext


async def rotate(session: AsyncSession, token: str) -> tuple[uuid.UUID, str]:
    """Return (user_id, new refresh token). Commits. Raises InvalidToken."""
    now = datetime.now(UTC)
    digest = hash_refresh_token(token)

    # Atomic claim: of two concurrent requests with the same token, exactly one wins.
    claimed = (
        await session.execute(
            update(RefreshToken)
            .where(
                RefreshToken.token_hash == digest,
                RefreshToken.revoked_at.is_(None),
                RefreshToken.expires_at > now,
            )
            .values(revoked_at=now)
            .returning(RefreshToken.user_id, RefreshToken.family_id)
        )
    ).first()

    if claimed is None:
        retired = (
            await session.execute(
                select(RefreshToken.family_id).where(
                    RefreshToken.token_hash == digest, RefreshToken.revoked_at.is_not(None)
                )
            )
        ).scalar_one_or_none()
        if retired is not None:  # reuse of a retired token
            await revoke_family(session, retired, now=now)
            await session.commit()
        raise InvalidToken("refresh token invalid, expired or reused")

    successor = await issue(session, claimed.user_id, family_id=claimed.family_id, now=now)
    await session.commit()
    return claimed.user_id, successor


async def revoke_family(
    session: AsyncSession, family_id: uuid.UUID, *, now: datetime | None = None
) -> None:
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=now or datetime.now(UTC))
    )


async def revoke_by_token(session: AsyncSession, token: str) -> None:
    """Logout: revoke the family the token belongs to. Unknown tokens are ignored."""
    family_id = (
        await session.execute(
            select(RefreshToken.family_id).where(
                RefreshToken.token_hash == hash_refresh_token(token)
            )
        )
    ).scalar_one_or_none()
    if family_id is not None:
        await revoke_family(session, family_id)
        await session.commit()
