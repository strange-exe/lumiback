"""Share sessions: create, list, inspect, stop, revoke viewers.

Visibility rules (PLAN §4.5): no relation to a session -> 404 (its existence is not revealed);
a viewer whose access ended -> 403; the sharer sees everything about their own session.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import or_, select

from app.api.deps import (
    CurrentUser,
    HubDep,
    LimiterDep,
    PrincipalDep,
    SessionDep,
    SettingsDep,
    enforce,
)
from app.models import (
    AccessChannel,
    SessionStatus,
    ShareSession,
    ShareViewer,
    User,
    ViewerStatus,
)
from app.realtime import AccessChanged, LocationUpdated
from app.schemas import (
    AccessLogEntry,
    CodeOut,
    LocationIn,
    SessionCreateIn,
    SessionLocationOut,
    SessionOut,
    SharerRef,
    StopIn,
    WatchingOut,
)
from app.security.rate_limit import Limit
from app.services import codes as code_svc
from app.services import locations as loc_svc
from app.services import sessions as svc
from app.services.authz import Role, is_live, resolve_access, resolve_user_access

router = APIRouter(prefix="/sessions", tags=["sessions"])

NOT_FOUND = HTTPException(status.HTTP_404_NOT_FOUND, detail="Session not found")
ACCESS_ENDED = HTTPException(status.HTTP_403_FORBIDDEN, detail="Your access to this session ended")
AWAITING_APPROVAL = HTTPException(
    status.HTTP_403_FORBIDDEN, detail="Waiting for the sharer to approve you"
)
SESSION_ENDED = HTTPException(status.HTTP_409_CONFLICT, detail="This session has ended")
CODES_PER_SHARER = Limit(max_hits=10, window_seconds=3600)
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
    session_id: uuid.UUID, principal: PrincipalDep, session: SessionDep
) -> SessionOut | WatchingOut:
    access = await resolve_access(session, session_id, principal)
    match access.role:
        case Role.SHARER:
            assert access.share is not None
            return await svc.sharer_view(session, access.share)
        case Role.VIEWER:
            assert access.share is not None
            sharer = await session.get(User, access.share.sharer_id)
            assert sharer is not None
            return _watching(access.share, sharer)
        case Role.PENDING:
            raise AWAITING_APPROVAL
        case Role.FORMER_VIEWER:
            raise ACCESS_ENDED
        case _:
            raise NOT_FOUND


@router.post("/{session_id}/stop")
async def stop_session(
    share: OwnSession, session: SessionDep, hub: HubDep, body: StopIn | None = None
) -> SessionOut:
    """One-tap stop: ends the session, deletes the location, cuts off every viewer."""
    reason = (body or StopIn()).reason
    if await svc.end(session, share.id, status=SessionStatus.REVOKED, reason=reason):
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


@router.post("/{session_id}/codes", status_code=status.HTTP_201_CREATED)
async def create_code(
    share: OwnSession, session: SessionDep, settings: SettingsDep, limiter: LimiterDep
) -> CodeOut:
    """A single-use join code, valid ~10 minutes. Whoever redeems it still needs approval."""
    if not is_live(share, datetime.now(UTC)):
        raise SESSION_ENDED
    await enforce(limiter, "codes:create", str(share.sharer_id), CODES_PER_SHARER)
    code, expires_at = await code_svc.create(
        session, share, settings.code_pepper.get_secret_value()
    )
    return CodeOut(code=code, expires_at=expires_at)


@router.post("/{session_id}/viewers/{viewer_id}/approve")
async def approve_viewer(
    viewer_id: uuid.UUID, share: OwnSession, session: SessionDep, hub: HubDep
) -> SessionOut:
    """The sharer's confirmation on their own device: the second side of consent."""
    if not is_live(share, datetime.now(UTC)):
        raise SESSION_ENDED
    if not await code_svc.approve(session, share.id, viewer_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No pending viewer with that id")
    await hub.publish(AccessChanged(share.id))
    return await svc.sharer_view(session, share)


LOCATION_UPDATES_PER_SESSION = Limit(max_hits=120, window_seconds=60)


@router.put("/{session_id}/location", status_code=status.HTTP_204_NO_CONTENT)
async def put_location(
    body: LocationIn, share: OwnSession, session: SessionDep, hub: HubDep, limiter: LimiterDep
) -> Response:
    """Sharer's device reports its latest position. Only the latest is kept."""
    await enforce(limiter, "location:session", str(share.id), LOCATION_UPDATES_PER_SESSION)
    try:
        await loc_svc.upsert(session, share.id, body)
    except loc_svc.SessionNotLive:
        raise SESSION_ENDED from None
    except loc_svc.FutureTimestamp:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, detail="recorded_at is in the future"
        ) from None
    await hub.publish(LocationUpdated(share.id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{session_id}/location")
async def get_location(
    session_id: uuid.UUID, principal: PrincipalDep, session: SessionDep
) -> SessionLocationOut:
    """Viewers read the latest position through can_view; every read is logged for the sharer."""
    access = await resolve_access(session, session_id, principal)
    match access.role:
        case Role.SHARER:
            pass  # sharers reading their own location are not logged
        case Role.VIEWER:
            assert access.viewer is not None
            await loc_svc.log_access(session, session_id, access.viewer.id, AccessChannel.HTTP)
        case Role.PENDING:
            raise AWAITING_APPROVAL
        case Role.FORMER_VIEWER:
            raise ACCESS_ENDED
        case _:
            raise NOT_FOUND
    return SessionLocationOut(
        session_id=session_id, location=await loc_svc.latest(session, session_id)
    )


@router.get("/{session_id}/access-log")
async def get_access_log(share: OwnSession, session: SessionDep) -> list[AccessLogEntry]:
    """Who looked at my location, and when (most recent first)."""
    return await loc_svc.access_log(session, share.id)
