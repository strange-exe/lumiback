"""Push tokens for the mobile app: registered after sign-in, removed on sign-out."""

from datetime import UTC, datetime

from fastapi import APIRouter, Request, Response, status
from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert

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
    values = {
        "user_id": me.id,
        "platform": body.platform,
        "muted": sorted(set(body.muted)),
        "family_id": family,
        # Updated every time: a phone back on older JS (an update rolled back) loses it.
        "draws_updates": body.draws_updates,
    }
    # One statement: the app registers on start and again right after sign-in, so two requests
    # for the same new token can overlap. A read-then-insert would let both insert, and the
    # second would fail on the unique token.
    await session.execute(
        insert(PushToken)
        .values(token=body.token, **values)
        .on_conflict_do_update(
            index_elements=["token"], set_={**values, "last_seen_at": datetime.now(UTC)}
        )
    )
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
