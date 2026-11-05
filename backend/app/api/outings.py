"""The student's own outings and today's weekend/holiday request. Admins see outings through
the admin API (app/api/admin.py)."""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, status

from app.api.deps import (
    CurrentUser,
    HubDep,
    LimiterDep,
    MailerDep,
    PushDep,
    SessionDep,
    SettingsDep,
)
from app.config import Settings
from app.email import Mailer
from app.models import LateReply, Outing, User
from app.push import PushMessage
from app.realtime import AccessChanged, Hub
from app.schemas import (
    LateReplyIn,
    OutingCreateIn,
    OutingOut,
    OutingPage,
    OutingRequestIn,
    OutingRequestOut,
    OutingSummary,
)
from app.security.rate_limit import RateLimiter
from app.services import escalations, requests, rules, safe_return, staff
from app.services import outings as svc

router = APIRouter(prefix="/outings", tags=["outings"])

NOT_OUT = HTTPException(status.HTTP_404_NOT_FOUND, detail="You are not on an outing")


def refused(e: rules.Refused) -> HTTPException:
    return HTTPException(status.HTTP_403_FORBIDDEN, detail=e.message)


@dataclass(frozen=True)
class SafeReturnSlot:
    """Safe return may start with this check-out: its start is already counted."""

    pepper: str
    reservation: safe_return.Reservation


async def safe_return_slot(
    wanted: bool, me: User, limiter: RateLimiter, settings: Settings
) -> SafeReturnSlot | None:
    """A slot to start safe return with, or None: not ticked, no emergency email, or over
    today's limit. The check-out itself goes ahead either way (its response then has no
    safe_return_session_id, which the app and website explain). A slot is counted against the
    limits before the check-out (counted and checked under one lock, so a burst can't pass
    them); every path that then starts no share must call release_unused."""
    if not (wanted and me.emergency_email):
        return None
    reservation = await safe_return.reserve(limiter, me.id, me.emergency_email)
    if reservation is None:
        return None
    return SafeReturnSlot(settings.code_pepper.get_secret_value(), reservation)


async def release_unused(
    limiter: RateLimiter, slot: SafeReturnSlot | None, outing: Outing | None
) -> None:
    """Gives the slot back unless `outing` started safe return with it (None: no outing was
    opened). Only starts that happen count, so failed tries can't use up a contact's limit."""
    if slot is not None and (outing is None or outing.safe_return_session_id is None):
        await safe_return.release(limiter, slot.reservation)


async def safe_return_started(
    outing: Outing,
    me: User,
    *,
    mailer: Mailer,
    settings: Settings,
    tasks: BackgroundTasks,
) -> None:
    """Emails the contact after the response (safe_return_slot already counted the start)."""
    if outing.safe_return_session_id is None or outing.safe_return_email is None:
        return
    email = safe_return.start_email(
        outing, me, settings.web_url, settings.code_pepper.get_secret_value()
    )
    tasks.add_task(safe_return.send, mailer, email)


async def safe_return_ended(
    back: safe_return.Back | None, *, hub: Hub, mailer: Mailer, tasks: BackgroundTasks
) -> None:
    """After a return's commit: cut the contact off now, and tell them the student is back."""
    if back is None:
        return
    await hub.publish(AccessChanged(back.session_id))
    tasks.add_task(safe_return.send, mailer, back.email)


@router.post("", status_code=status.HTTP_201_CREATED)
async def check_out(
    body: OutingCreateIn,
    me: CurrentUser,
    session: SessionDep,
    settings: SettingsDep,
    limiter: LimiterDep,
    mailer: MailerDep,
    tasks: BackgroundTasks,
) -> OutingOut:
    slot = await safe_return_slot(body.safe_return, me, limiter, settings)
    try:
        outing = await svc.check_out(
            session, me, body, safe_return_pepper=slot.pepper if slot else None
        )
    except rules.Refused as e:
        await release_unused(limiter, slot, None)
        raise refused(e) from None
    except svc.AlreadyOut:
        await release_unused(limiter, slot, None)
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="You are already on an outing; mark your return first"
        ) from None
    except BaseException:
        # Any other failure gives the slot back too, or a request that errors on purpose
        # could use up another student's contact limit. The share and outing commit together,
        # so a failed check-out almost always saved neither; at worst one start goes uncounted.
        await release_unused(limiter, slot, None)
        raise
    await release_unused(limiter, slot, outing)
    await safe_return_started(outing, me, mailer=mailer, settings=settings, tasks=tasks)
    return svc.to_out(outing, datetime.now(UTC))


@router.get("/current")
async def current(me: CurrentUser, session: SessionDep) -> OutingOut | None:
    outing = await svc.current(session, me.id)
    return svc.to_out(outing, datetime.now(UTC)) if outing else None


@router.patch("/current", deprecated=True)
async def extend(_me: CurrentUser) -> OutingOut:
    """Return times are fixed by the hostel's rules; kept so older apps get a clear answer.
    Whatever body an older app sends is ignored (never read, so never a validation error)."""
    raise HTTPException(
        status.HTTP_403_FORBIDDEN,
        detail="Return times can't be extended. If you'll be late, tell your warden.",
    )


@router.post("/current/return")
async def mark_return(
    me: CurrentUser,
    session: SessionDep,
    settings: SettingsDep,
    hub: HubDep,
    mailer: MailerDep,
    tasks: BackgroundTasks,
) -> OutingOut:
    returned = await svc.mark_return(session, me.id, pepper=settings.code_pepper.get_secret_value())
    if returned is None:
        raise NOT_OUT
    await safe_return_ended(returned.back, hub=hub, mailer=mailer, tasks=tasks)
    return svc.to_out(returned.outing, datetime.now(UTC))


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
    body: OutingRequestIn, me: CurrentUser, session: SessionDep, push: PushDep
) -> OutingRequestOut:
    name, hostel_id = me.name, me.hostel_id  # readable even if create() rolls back
    try:
        r = await requests.create(session, me, body)
    except rules.Refused as e:
        raise refused(e) from None
    except requests.AlreadyRequested as e:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="You've already used today's approved outing."
            if e.used
            else "You already asked for today's outing. Cancel it first to change it.",
        ) from None
    out = await _request_out(session, r)
    # The hostel's wardens (or the admins, if it has none) decide it: tell them now.
    for person in await staff.office_for(session, hostel_id):
        push.to_user(
            person.id,
            PushMessage(
                title="New outing request",
                body=f"{name} asked for today's outing.",
                url="/office/requests",
                channel="share-status",  # the app's "Sharing and requests" switch
            ),
        )
    return out


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
    except escalations.NotLate:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="You're not late yet.") from None
    return svc.to_out(outing, datetime.now(UTC))
