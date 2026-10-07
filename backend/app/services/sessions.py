"""Share-session lifecycle: create, stop, revoke viewers, and the sharer's view.

Callers publish `AccessChanged` *after* these functions commit, so live subscribers re-check
against the committed state.
"""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Contact,
    ContactStatus,
    EndsWhen,
    Location,
    SessionStatus,
    ShareSession,
    ShareSource,
    ShareViewer,
    User,
    ViewerStatus,
)
from app.schemas import SessionCreateIn, SessionOut, ViewerOut
from app.services.authz import is_live

ENDS_WHEN = {
    ShareSource.MANUAL: EndsWhen.DURATION,
    ShareSource.TAB_LIVE: EndsWhen.TAB_CLOSED,
    ShareSource.APP: EndsWhen.DURATION,
}


class NotYourContacts(Exception):
    """Some requested viewers are not the sharer's accepted contacts (A8)."""


async def create(session: AsyncSession, sharer: User, body: SessionCreateIn) -> ShareSession:
    now = datetime.now(UTC)
    source = ShareSource(body.source)
    wanted = set(body.viewer_user_ids)
    if wanted:
        allowed = set(
            (
                await session.execute(
                    select(Contact.contact_user_id).where(
                        Contact.owner_id == sharer.id,
                        Contact.status == ContactStatus.ACCEPTED,
                        Contact.contact_user_id.in_(wanted),
                    )
                )
            ).scalars()
        )
        if allowed != wanted:
            raise NotYourContacts

    share = ShareSession(
        sharer_id=sharer.id,
        source=source,
        ends_when=ENDS_WHEN[source],
        ends_at=now + timedelta(minutes=body.duration_minutes),
    )
    session.add(share)
    await session.flush()
    # The sharer chose these people explicitly, and each accepted being a contact: both sides
    # have consented, so access is granted immediately. (Code-joined guests start pending.)
    session.add_all(
        ShareViewer(
            session_id=share.id,
            viewer_user_id=user_id,
            status=ViewerStatus.GRANTED,
            granted_at=now,
        )
        for user_id in body.viewer_user_ids
    )
    await session.commit()
    return share


async def end(
    session: AsyncSession, share_id: uuid.UUID, *, status: SessionStatus, reason: str
) -> bool:
    """End an active session and delete its location in one transaction. Idempotent."""
    ended = (
        await session.execute(
            update(ShareSession)
            .where(ShareSession.id == share_id, ShareSession.status == SessionStatus.ACTIVE)
            .values(status=status, ended_at=datetime.now(UTC), ended_reason=reason)
            .returning(ShareSession.id)
        )
    ).scalar_one_or_none()
    await session.execute(delete(Location).where(Location.session_id == share_id))
    await session.commit()
    return ended is not None


async def revoke_viewer(session: AsyncSession, share_id: uuid.UUID, viewer_id: uuid.UUID) -> bool:
    revoked = (
        await session.execute(
            update(ShareViewer)
            .where(
                ShareViewer.id == viewer_id,
                ShareViewer.session_id == share_id,
                ShareViewer.status != ViewerStatus.REVOKED,
            )
            .values(status=ViewerStatus.REVOKED, revoked_at=datetime.now(UTC))
            .returning(ShareViewer.id)
        )
    ).scalar_one_or_none()
    await session.commit()
    return revoked is not None


def effective_status(share: ShareSession, now: datetime) -> str:
    if share.status == SessionStatus.ACTIVE and not is_live(share, now):
        return SessionStatus.ENDED.value  # expired; the sweep job will persist this
    return share.status.value


async def sharer_view(session: AsyncSession, share: ShareSession) -> SessionOut:
    rows = await session.execute(
        select(ShareViewer, User.name)
        .outerjoin(User, User.id == ShareViewer.viewer_user_id)
        .where(ShareViewer.session_id == share.id)
        .order_by(ShareViewer.requested_at)
        .execution_options(populate_existing=True)
    )
    viewers = [
        ViewerOut(
            id=v.id,
            kind="user" if v.viewer_user_id else "guest",
            name=name if v.viewer_user_id else (v.guest_label or "Guest"),
            status=v.status.value,
            requested_at=v.requested_at,
            granted_at=v.granted_at,
            revoked_at=v.revoked_at,
        )
        for v, name in rows
    ]
    return SessionOut(
        id=share.id,
        source=share.source.value,
        ends_when=share.ends_when.value,
        status=effective_status(share, datetime.now(UTC)),
        ends_at=share.ends_at,
        created_at=share.created_at,
        ended_at=share.ended_at,
        ended_reason=share.ended_reason,
        viewers=viewers,
    )
