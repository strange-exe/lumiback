"""Refresh-token lifecycle: issue, rotate (with reuse detection), revoke, and signed-in devices.

Every login starts a *family*: one signed-in device. Each refresh atomically retires the
presented token and issues a successor in the same family. If a retired token is ever presented
again, someone holds a copy (theft or replay), so the whole family is revoked and every holder
must log in again.

Locking: rotation takes a shared lock on the user's row before claiming a token, and every
"sign out everywhere" takes an exclusive lock on that row before revoking. So a reset can't
miss a successor that a refresh is committing at the same moment (the refresh finishes first
and the revoke then sees its successor, or the reset finishes first and the claim fails), and
both paths lock user then tokens, in the same order.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import Select, delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PushToken, RefreshToken, User
from app.security.tokens import REFRESH_TTL, InvalidToken, hash_refresh_token, new_refresh_token


@dataclass(frozen=True)
class Rotated:
    user_id: uuid.UUID
    family_id: uuid.UUID
    token: str


async def issue(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    family_id: uuid.UUID | None = None,
    device: str | None = None,
    signed_in_at: datetime | None = None,
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
            device=device,
            signed_in_at=signed_in_at or now,
        )
    )
    return plaintext


async def rotate(session: AsyncSession, token: str) -> Rotated:
    """Retire the token and issue its successor. Commits. Raises InvalidToken."""
    now = datetime.now(UTC)
    digest = hash_refresh_token(token)

    owner = await session.scalar(
        select(RefreshToken.user_id).where(RefreshToken.token_hash == digest)
    )
    if owner is not None:  # see the module docstring: user row first, then the token
        await session.execute(select(User.id).where(User.id == owner).with_for_update(read=True))

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
            .returning(
                RefreshToken.user_id,
                RefreshToken.family_id,
                RefreshToken.device,
                RefreshToken.signed_in_at,
                RefreshToken.created_at,
            )
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
        if retired is not None and owner is not None:  # reuse of a retired token
            # Revoking needs the exclusive lock, like every sign-out: a refresh of this family
            # in flight (holding the shared one) must finish first so its successor is seen.
            # Drop the shared lock first: two replays upgrading at once would deadlock.
            await session.rollback()
            await lock_user(session, owner)
            await revoke_family(session, retired, now=now)
            await session.commit()
        else:
            await session.rollback()
        raise InvalidToken("refresh token invalid, expired or reused")

    successor = await issue(
        session,
        claimed.user_id,
        family_id=claimed.family_id,
        device=claimed.device,
        signed_in_at=claimed.signed_in_at or claimed.created_at,
        now=now,
    )
    await session.commit()
    return Rotated(claimed.user_id, claimed.family_id, successor)


async def revoke_family(
    session: AsyncSession, family_id: uuid.UUID, *, now: datetime | None = None
) -> None:
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=now or datetime.now(UTC))
    )
    # That device is signed out: it must stop getting pushes too.
    await session.execute(delete(PushToken).where(PushToken.family_id == family_id))


async def revoke_by_token(session: AsyncSession, token: str) -> None:
    """Logout: revoke the family the token belongs to. Unknown tokens are ignored."""
    found = (
        await session.execute(
            select(RefreshToken.user_id, RefreshToken.family_id).where(
                RefreshToken.token_hash == hash_refresh_token(token)
            )
        )
    ).first()
    if found is not None:
        await lock_user(session, found.user_id)  # like every sign-out: see lock_user
        await revoke_family(session, found.family_id)
        await session.commit()


async def lock_user(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Every sign-out, sign-in and password change takes this first (before any token, reset
    or link row, so they all lock in one order). `rotate` holds the same row FOR SHARE from
    claiming a token until its successor is saved, so a sign-out waits for a refresh in flight
    and then revokes the successor too, instead of missing it."""
    await session.execute(select(User.id).where(User.id == user_id).with_for_update())


async def sign_out_everywhere(
    session: AsyncSession, user_id: uuid.UUID, now: datetime | None = None
) -> None:
    """Every device: tokens revoked and push tokens dropped. Doesn't commit (the caller's
    change, a new password or an account turned off, commits with it)."""
    await lock_user(session, user_id)
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=now or datetime.now(UTC))
    )
    await session.execute(delete(PushToken).where(PushToken.user_id == user_id))


# ---------- signed-in devices ----------


@dataclass(frozen=True)
class Device:
    id: uuid.UUID  # the family
    device: str | None
    signed_in_at: datetime
    last_active_at: datetime  # the last refresh (or the sign-in)


async def devices(session: AsyncSession, user_id: uuid.UUID) -> list[Device]:
    """The user's signed-in devices, most recently active first: each family's live token."""
    now = datetime.now(UTC)
    live = await session.scalars(
        select(RefreshToken)
        .where(
            RefreshToken.user_id == user_id,
            RefreshToken.revoked_at.is_(None),
            RefreshToken.expires_at > now,
        )
        .order_by(RefreshToken.created_at.desc())
    )
    seen: set[uuid.UUID] = set()
    out: list[Device] = []
    for t in live:
        if t.family_id in seen:  # only possible in the middle of a rotation
            continue
        seen.add(t.family_id)
        out.append(Device(t.family_id, t.device, t.signed_in_at or t.created_at, t.created_at))
    return out


def _live(user_id: uuid.UUID, family_id: uuid.UUID) -> Select:
    """A live (unrevoked, unexpired) token of that user's sign-in."""
    return select(RefreshToken.id).where(
        RefreshToken.user_id == user_id,
        RefreshToken.family_id == family_id,
        RefreshToken.revoked_at.is_(None),
        RefreshToken.expires_at > datetime.now(UTC),
    )


async def is_live(session: AsyncSession, user_id: uuid.UUID, family_id: uuid.UUID) -> bool:
    """Whether that sign-in is still on: an access token from a device signed out (or from
    before a reset) stops working at once, not when it expires."""
    return await session.scalar(_live(user_id, family_id).limit(1)) is not None


async def signed_in_user(
    session: AsyncSession, user_id: uuid.UUID, family_id: uuid.UUID | None
) -> User | None:
    """The account an access token names, or None when it's gone or the token's sign-in
    (family_id; None for tokens from before 2026-11-07) is no longer live (is_live).

    One query for both checks: every authenticated request runs this, so it costs one round
    trip, not two. Callers still check `active` and `email_verified` themselves."""
    query = select(User).where(User.id == user_id)
    if family_id is not None:
        query = query.where(_live(user_id, family_id).exists())
    return await session.scalar(query)


async def _drop_unowned_push_tokens(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Push tokens that no live sign-in owns: saved before devices had ids (family NULL), or
    registered by a sign-in that has since ended. Nothing says which phone they belong to, so
    after a sign-out they go; a phone still signed in registers again when the app opens."""
    live = select(RefreshToken.family_id).where(
        RefreshToken.user_id == user_id,
        RefreshToken.revoked_at.is_(None),
        RefreshToken.expires_at > datetime.now(UTC),
    )
    await session.execute(
        delete(PushToken).where(
            PushToken.user_id == user_id,
            or_(PushToken.family_id.is_(None), PushToken.family_id.not_in(live)),
        )
    )


async def sign_out_device(session: AsyncSession, user_id: uuid.UUID, family_id: uuid.UUID) -> bool:
    """Signs out one of the user's devices. False if it isn't one of theirs. Commits."""
    await lock_user(session, user_id)
    mine = await session.scalar(
        select(RefreshToken.id)
        .where(RefreshToken.user_id == user_id, RefreshToken.family_id == family_id)
        .limit(1)
    )
    if mine is None:
        await session.rollback()
        return False
    await revoke_family(session, family_id)
    await _drop_unowned_push_tokens(session, user_id)
    await session.commit()
    return True


async def sign_out_others(session: AsyncSession, user_id: uuid.UUID, keep: uuid.UUID) -> int:
    """Signs out every device but `keep` (the one asking). Returns how many. Commits."""
    count = await sign_out_all_but(session, user_id, keep)
    await session.commit()
    return count


async def sign_out_all_but(
    session: AsyncSession, user_id: uuid.UUID, keep: uuid.UUID | None
) -> int:
    """Every device but `keep` (None: every device, e.g. a sign-in from before devices had ids).
    Returns how many devices were listed. Doesn't commit: a new password commits with it."""
    if keep is None:
        count = len(await devices(session, user_id))
        await sign_out_everywhere(session, user_id)
        return count
    await lock_user(session, user_id)
    others = [d.id for d in await devices(session, user_id) if d.id != keep]
    for family_id in others:
        await revoke_family(session, family_id)
    await _drop_unowned_push_tokens(session, user_id)
    return len(others)
