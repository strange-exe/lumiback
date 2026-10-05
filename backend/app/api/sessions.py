"""Share sessions: create, list, inspect, stop, revoke viewers.

Visibility rules (PLAN §4.5): no relation to a session -> 404 (its existence is not revealed);
a viewer whose access ended -> 403; the sharer sees everything about their own session.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select

from app.api.deps import CurrentUser, HubDep, SessionDep
from app.models import SessionStatus, ShareSession, ShareViewer, User, ViewerStatus
from app.realtime import AccessChanged
from app.schemas import SessionCreateIn, SessionOut, SharerRef, WatchingOut
from app.services import sessions as svc
from app.services.authz import Role, resolve_user_access

router = APIRouter(prefix="/sessions", tags=["sessions"])

NOT_FOUND = HTTPException(status.HTTP_404_NOT_FOUND, detail="Session not found")
ACCESS_ENDED = HTTPException(status.HTTP_403_FORBIDDEN, detail="Your access to this session ended")
RECENT = timedelta(hours=24)


async def own_session(session: SessionDep, me: CurrentUser, session_id: uuid.UUID) -> ShareSession:
    access = await resolve_user_access(session, session_id, me.id)
    if access.role is not Role.SHARER:
        raise NOT_FOUND  # viewers cannot manage a session either
    assert access.share is not None
    return access.share


OwnSession = Annotated[ShareSession, Depends(own_session)]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_session(body: SessionCreateIn, me: CurrentUser, session: SessionDep) -> SessionOut:
    try:
        share = await svc.create(session, me, body)
    except svc.NotYourContacts:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="You can only share with your accepted contacts",
        ) from None
    return await svc.sharer_view(session, share)


@router.get("/mine")
async def my_sessions(me: CurrentUser, session: SessionDep) -> list[SessionOut]:
    """Active sessions and those that ended in the last 24 hours."""
    shares = (
        await session.execute(
            select(ShareSession)
            .where(
                ShareSession.sharer_id == me.id,
                or_(
                    ShareSession.status == SessionStatus.ACTIVE,
                    ShareSession.ended_at > datetime.now(UTC) - RECENT,
                ),
            )
            .order_by(ShareSession.created_at.desc())
        )
    ).scalars()
    return [await svc.sharer_view(session, s) for s in shares]


@router.get("/watching")
async def watching(me: CurrentUser, session: SessionDep) -> list[WatchingOut]:
    rows = await session.execute(
        select(ShareSession, User)
        .join(ShareViewer, ShareViewer.session_id == ShareSession.id)
        .join(User, User.id == ShareSession.sharer_id)
        .where(
            ShareViewer.viewer_user_id == me.id,
            ShareViewer.status == ViewerStatus.GRANTED,
            ShareSession.status == SessionStatus.ACTIVE,
            ShareSession.ends_at > datetime.now(UTC),
        )
        .order_by(ShareSession.ends_at)
    )
    return [_watching(share, sharer) for share, sharer in rows]


def _watching(share: ShareSession, sharer: User) -> WatchingOut:
    return WatchingOut(
        id=share.id,
        sharer=SharerRef(id=sharer.id, name=sharer.name),
        source=share.source.value,
        ends_at=share.ends_at,
    )


@router.get("/{session_id}")
async def get_session(
    session_id: uuid.UUID, me: CurrentUser, session: SessionDep
) -> SessionOut | WatchingOut:
    access = await resolve_user_access(session, session_id, me.id)
    match access.role:
        case Role.SHARER:
            assert access.share is not None
            return await svc.sharer_view(session, access.share)
        case Role.VIEWER:
            assert access.share is not None
            sharer = await session.get(User, access.share.sharer_id)
            assert sharer is not None
            return _watching(access.share, sharer)
        case Role.FORMER_VIEWER:
            raise ACCESS_ENDED
        case _:
            raise NOT_FOUND


@router.post("/{session_id}/stop")
async def stop_session(share: OwnSession, session: SessionDep, hub: HubDep) -> SessionOut:
    """One-tap stop: ends the session, deletes the location, cuts off every viewer."""
    if await svc.end(session, share.id, status=SessionStatus.REVOKED, reason="stopped_by_sharer"):
        await hub.publish(AccessChanged(share.id))
    await session.refresh(share)
    return await svc.sharer_view(session, share)


@router.post("/{session_id}/viewers/{viewer_id}/revoke")
async def revoke_viewer(
    viewer_id: uuid.UUID, share: OwnSession, session: SessionDep, hub: HubDep
) -> SessionOut:
    if not await svc.revoke_viewer(session, share.id, viewer_id):
        exists = await session.get(ShareViewer, viewer_id)
        if exists is None or exists.session_id != share.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Viewer not found")
    else:
        await hub.publish(AccessChanged(share.id))
    return await svc.sharer_view(session, share)
