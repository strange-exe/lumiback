"""The single authorization rule for viewing a share session (PLAN §4.4).

Every HTTP read and every WebSocket send goes through `can_view`. Expiry is checked inline
(`ends_at > now`), so access ends on time even if the expiry job is late or down.
"""

import enum
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import SessionStatus, ShareSession, ShareViewer, ViewerStatus


def is_live(share: ShareSession, now: datetime) -> bool:
    return share.status == SessionStatus.ACTIVE and share.ends_at > now


def can_view(share: ShareSession, viewer: ShareViewer, now: datetime) -> bool:
    return (
        is_live(share, now)
        and viewer.session_id == share.id
        and viewer.status == ViewerStatus.GRANTED
    )


class Role(enum.Enum):
    SHARER = "sharer"
    VIEWER = "viewer"  # currently allowed to view
    PENDING = "pending"  # joined with a code, waiting for the sharer's approval -> 403
    FORMER_VIEWER = "former_viewer"  # knew about the session, but no access now -> 403
    NONE = "none"  # no relation -> 404 (do not reveal that the session exists)


@dataclass(frozen=True)
class Access:
    role: Role
    share: ShareSession | None = None
    viewer: ShareViewer | None = None


@dataclass(frozen=True)
class Principal:
    """Who is asking: a logged-in user, or a guest holding a guest token (hash)."""

    user_id: uuid.UUID | None = None
    guest_token_hash: bytes | None = None

    def __post_init__(self) -> None:
        if (self.user_id is None) == (self.guest_token_hash is None):
            raise ValueError("a principal is exactly one of user or guest")


async def resolve_access(
    session: AsyncSession, session_id: uuid.UUID, principal: Principal
) -> Access:
    if principal.user_id is not None:
        return await resolve_user_access(session, session_id, principal.user_id)
    assert principal.guest_token_hash is not None
    return await resolve_guest_access(session, session_id, principal.guest_token_hash)


async def resolve_user_access(
    session: AsyncSession, session_id: uuid.UUID, user_id: uuid.UUID
) -> Access:
    share = await session.get(ShareSession, session_id, populate_existing=True)
    if share is None:
        return Access(Role.NONE)
    if share.sharer_id == user_id:
        return Access(Role.SHARER, share)
    viewer = (
        await session.execute(
            select(ShareViewer)
            .where(ShareViewer.session_id == session_id, ShareViewer.viewer_user_id == user_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    return _classify(share, viewer)


async def resolve_guest_access(
    session: AsyncSession, session_id: uuid.UUID, guest_token_hash: bytes
) -> Access:
    viewer = (
        await session.execute(
            select(ShareViewer)
            .where(
                ShareViewer.session_id == session_id,
                ShareViewer.guest_token_hash == guest_token_hash,
            )
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if viewer is None:
        return Access(Role.NONE)
    share = await session.get(ShareSession, session_id, populate_existing=True)
    return _classify(share, viewer)


def _classify(share: ShareSession | None, viewer: ShareViewer | None) -> Access:
    if share is None or viewer is None:
        return Access(Role.NONE)
    now = datetime.now(UTC)
    if can_view(share, viewer, now):
        return Access(Role.VIEWER, share, viewer)
    if viewer.status == ViewerStatus.PENDING and is_live(share, now):
        return Access(Role.PENDING, share, viewer)
    return Access(Role.FORMER_VIEWER, share, viewer)
