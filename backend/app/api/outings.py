"""The student's own outings and today's weekend/holiday request. Admins see outings through
the admin API (app/api/admin.py)."""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.api.deps import CurrentUser, SessionDep
from app.models import LateReply
from app.schemas import (
    LateReplyIn,
    OutingCreateIn,
    OutingExtendIn,
    OutingOut,
    OutingPage,
    OutingRequestIn,
    OutingRequestOut,
    OutingSummary,
)
from app.services import escalations, requests, rules
from app.services import outings as svc

router = APIRouter(prefix="/outings", tags=["outings"])

NOT_OUT = HTTPException(status.HTTP_404_NOT_FOUND, detail="You are not on an outing")


def refused(e: rules.Refused) -> HTTPException:
    return HTTPException(status.HTTP_403_FORBIDDEN, detail=e.message)


@router.post("", status_code=status.HTTP_201_CREATED)
async def check_out(body: OutingCreateIn, me: CurrentUser, session: SessionDep) -> OutingOut:
    try:
        outing = await svc.check_out(session, me, body)
    except rules.Refused as e:
        raise refused(e) from None
    except svc.AlreadyOut:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="You are already on an outing; mark your return first"
        ) from None
    return svc.to_out(outing, datetime.now(UTC))


@router.get("/current")
async def current(me: CurrentUser, session: SessionDep) -> OutingOut | None:
    outing = await svc.current(session, me.id)
    return svc.to_out(outing, datetime.now(UTC)) if outing else None


@router.patch("/current", deprecated=True)
async def extend(_body: OutingExtendIn, _me: CurrentUser) -> OutingOut:
    """Return times are fixed by the hostel's rules; kept so older apps get a clear answer."""
    raise HTTPException(
        status.HTTP_403_FORBIDDEN,
        detail="Return times can't be extended. If you'll be late, tell your warden.",
    )


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


# ---------- today's weekend/holiday request (the outing form) ----------


async def _request_out(session, r) -> OutingRequestOut:
    return OutingRequestOut(
        id=r.id,
        day=r.day,
        purpose=r.purpose,
        requested_minutes=r.requested_minutes,
        status=r.status.value,
        note=r.note,
        decided_at=r.decided_at,
        created_at=r.created_at,
        used=await requests.is_used(session, r.id),
    )


@router.get("/request")
async def todays_request(me: CurrentUser, session: SessionDep) -> OutingRequestOut | None:
    r = await requests.latest_today(session, me.id, rules.ist_date(datetime.now(UTC)))
    return await _request_out(session, r) if r else None


@router.post("/request", status_code=status.HTTP_201_CREATED)
async def send_request(
    body: OutingRequestIn, me: CurrentUser, session: SessionDep
) -> OutingRequestOut:
    try:
        r = await requests.create(session, me, body)
    except rules.Refused as e:
        raise refused(e) from None
    except requests.AlreadyRequested:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="You already asked for today's outing. Cancel it first to change it.",
        ) from None
    return await _request_out(session, r)


@router.delete("/request/{request_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_request(request_id: uuid.UUID, me: CurrentUser, session: SessionDep) -> None:
    try:
        await requests.cancel(session, me.id, request_id)
    except requests.NotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No such request") from None
    except requests.NotPending:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="This request was already used or closed"
        ) from None


@router.post("/current/late-reply")
async def late_reply(body: LateReplyIn, me: CurrentUser, session: SessionDep) -> OutingOut:
    """The answer to "you're late, are you OK?": stops the escalation to the hostel office."""
    try:
        outing = await escalations.reply(session, me.id, LateReply(body.reply))
    except escalations.NotOut:
        raise NOT_OUT from None
    return svc.to_out(outing, datetime.now(UTC))
