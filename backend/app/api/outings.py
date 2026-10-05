"""The student's own outings. Nobody else can read or change them (no admin role)."""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.api.deps import CurrentUser, SessionDep
from app.schemas import OutingCreateIn, OutingExtendIn, OutingOut, OutingPage, OutingSummary
from app.services import outings as svc

router = APIRouter(prefix="/outings", tags=["outings"])

NOT_OUT = HTTPException(status.HTTP_404_NOT_FOUND, detail="You are not on an outing")


def _invalid(e: svc.InvalidReturnTime) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(e))


@router.post("", status_code=status.HTTP_201_CREATED)
async def check_out(body: OutingCreateIn, me: CurrentUser, session: SessionDep) -> OutingOut:
    try:
        outing = await svc.check_out(session, me.id, body)
    except svc.InvalidReturnTime as e:
        raise _invalid(e) from None
    except svc.AlreadyOut:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="You are already on an outing; mark your return first"
        ) from None
    return svc.to_out(outing, datetime.now(UTC))


@router.get("/current")
async def current(me: CurrentUser, session: SessionDep) -> OutingOut | None:
    outing = await svc.current(session, me.id)
    return svc.to_out(outing, datetime.now(UTC)) if outing else None


@router.patch("/current")
async def extend(body: OutingExtendIn, me: CurrentUser, session: SessionDep) -> OutingOut:
    """Running late? Update the expected return so nobody worries unnecessarily."""
    try:
        outing = await svc.extend(session, me.id, body.expected_return_at)
    except svc.InvalidReturnTime as e:
        raise _invalid(e) from None
    if outing is None:
        raise NOT_OUT
    return svc.to_out(outing, datetime.now(UTC))


@router.post("/current/return")
async def mark_return(me: CurrentUser, session: SessionDep) -> OutingOut:
    outing = await svc.mark_return(session, me.id)
    if outing is None:
        raise NOT_OUT
    return svc.to_out(outing, datetime.now(UTC))


@router.get("")
async def history(
    me: CurrentUser,
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    before: datetime | None = None,
) -> OutingPage:
    if before is not None and before.tzinfo is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, detail="before must include a timezone offset"
        )
    return await svc.history(session, me.id, limit=limit, before=before)


@router.get("/summary")
async def summary(me: CurrentUser, session: SessionDep) -> OutingSummary:
    return await svc.summary(session, me.id)
