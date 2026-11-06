"""Push tokens for the mobile app: registered after sign-in, removed on sign-out."""

from datetime import UTC, datetime

from fastapi import APIRouter, Request, Response, status
from sqlalchemy import delete, select

from app.api.deps import CurrentUser, SessionDep
from app.models import PushToken
from app.schemas import PushTokenIn

router = APIRouter(prefix="/devices", tags=["devices"])


@router.post("/push-token", status_code=status.HTTP_204_NO_CONTENT)
async def register(
    body: PushTokenIn, me: CurrentUser, request: Request, session: SessionDep
) -> Response:
    """Idempotent. A token moves to whoever signed in on that phone most recently, so a shared
    or handed-down phone never pushes one student's notifications to another. It belongs to
    this sign-in: signing the device out (or a password reset) drops it."""
    family = getattr(request.state, "session_id", None)
    existing = await session.scalar(select(PushToken).where(PushToken.token == body.token))
    muted = sorted(set(body.muted))
    if existing is None:
        session.add(
            PushToken(
                user_id=me.id,
                token=body.token,
                platform=body.platform,
                muted=muted,
                family_id=family,
            )
        )
    else:
        existing.user_id = me.id
        existing.family_id = family
        existing.platform = body.platform
        existing.muted = muted
        existing.last_seen_at = datetime.now(UTC)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/push-token/remove", status_code=status.HTTP_204_NO_CONTENT)
async def remove(body: PushTokenIn, me: CurrentUser, session: SessionDep) -> Response:
    """Sign-out on this phone: stop pushing here. Only the signed-in owner can remove it."""
    await session.execute(
        delete(PushToken).where(PushToken.token == body.token, PushToken.user_id == me.id)
    )
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
