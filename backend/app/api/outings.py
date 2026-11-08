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
    OutboxDep,
    PushDep,
    SessionDep,
    SettingsDep,
    enforce,
)
from app.config import Settings
from app.email import Mailer
from app.email_templates import Fix
from app.models import LateReply, Outing, User
from app.push import PushMessage
from app.realtime import AccessChanged, Hub
from app.schemas import (
    CallMeOut,
    CorrectionIn,
    CorrectionOut,
    HelpIn,
    HelpOut,
    LateReplyIn,
    OutingCreateIn,
    OutingOut,
    OutingPage,
    OutingRequestIn,
    OutingRequestOut,
    OutingSummary,
    RunningLateIn,
)
from app.security.rate_limit import Limit, RateLimiter
from app.services import (
    alerts,
    corrections,
    escalations,
    requests,
    rules,
    running_late,
    safe_return,
    staff,
)
from app.services import outings as svc

router = APIRouter(prefix="/outings", tags=["outings"])

# Asking the office to correct an outing: a few a day is plenty.
CORRECTION_ASKS = Limit(max_hits=10, window_seconds=86_400)
# Each one wakes the hostel's wardens (urgent: muted phones too), so a few an hour at most.
CALL_ME = Limit(max_hits=3, window_seconds=3600)
# Help reaches the office, the student's followers and their contact; a second press must
# still work (they may doubt the first went), but not an endless stream.
HELP_ASKS = Limit(max_hits=5, window_seconds=3600)
# Each check-out (and the "I'm back" that ends it) notifies the student's followers, and a
# running-late move the office: far above any real evening, but not an endless loop (audit
# run-8). A request pushes the office each time it's made.
CHECK_OUTS = Limit(max_hits=20, window_seconds=3600)
REQUESTS_MADE = Limit(max_hits=10, window_seconds=3600)

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
    await enforce(limiter, "check-out:user", str(me.id), CHECK_OUTS)
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


async def _with_corrections(session: SessionDep, items: list[OutingOut]) -> list[OutingOut]:
    found = await corrections.latest(session, [o.id for o in items])
    for o in items:
        o.correction = found.get(o.id)
    return items


@router.get("/current")
async def current(me: CurrentUser, session: SessionDep) -> OutingOut | None:
    outing = await svc.current(session, me.id)
    if outing is None:
        return None
    out = (await _with_corrections(session, [svc.to_out(outing, datetime.now(UTC))]))[0]
    out.office = await alerts.office_contact(session, outing)
    return out


async def _out_now(session: SessionDep, me: User) -> Outing:
    """The student's open outing: calling the office and Help are for students who are out."""
    outing = await svc.current(session, me.id)
    if outing is None:
        raise NOT_OUT
    return outing


@router.post("/current/call-me", status_code=status.HTTP_202_ACCEPTED)
async def ask_for_a_call(
    me: CurrentUser, session: SessionDep, limiter: LimiterDep, sender: OutboxDep
) -> CallMeOut:
    """ "Ask the office to call me", for a hostel with no office number: tells its wardens (or
    the head wardens or admins if it has none)."""
    outing = await _out_now(session, me)
    await enforce(limiter, "call-me:user", str(me.id), CALL_ME)
    ids = await alerts.call_me(session, me, outing, sender.web_url)
    await session.commit()
    sender.send_now(ids)
    return CallMeOut(notified=len(ids))


@router.post("/current/help", status_code=status.HTTP_201_CREATED)
async def ask_for_help(
    body: HelpIn, me: CurrentUser, session: SessionDep, limiter: LimiterDep, sender: OutboxDep
) -> HelpOut:
    """The Help button (the app and website confirm first): an urgent alert to the hostel
    office with one location fix, and to the people the student shares their location with
    and their emergency contact. Answers with the office number to call."""
    outing = await _out_now(session, me)
    await enforce(limiter, "help:user", str(me.id), HELP_ASKS)
    fix = Fix(**body.location.model_dump()) if body.location else None

    async def contact_ok(address: str) -> bool:
        return await alerts.help_contact_allowed(limiter, me.id, address)

    sent = await alerts.help_alert(
        session, me, outing, fix, datetime.now(UTC), sender.web_url, contact_ok
    )
    await session.commit()
    sender.send_now(sent.ids)
    return HelpOut(
        office=sent.office,
        office_told=sent.office_told,
        followers_told=sent.followers_told,
        contact_told=sent.contact_told,
    )


@router.post("/current/running-late")
async def say_running_late(
    body: RunningLateIn, me: CurrentUser, session: SessionDep, sender: OutboxDep
) -> OutingOut:
    """ "I'm running late": moves the due time 15, 30 or 60 minutes, once per outing, until
    the late alert has gone (services/running_late.py). The hostel office and the people the
    student shares their location with are told."""
    try:
        moved = await running_late.tell(session, me, body.minutes, body.reason, sender.web_url)
    except running_late.NotOut:
        raise NOT_OUT from None
    except running_late.Refused as e:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=e.message) from None
    await session.commit()
    sender.send_now(moved.alerts)
    out = (await _with_corrections(session, [svc.to_out(moved.outing, datetime.now(UTC))]))[0]
    out.office = await alerts.office_contact(session, moved.outing)
    return out


@router.post("/{outing_id}/correction", status_code=status.HTTP_201_CREATED)
async def ask_correction(
    outing_id: uuid.UUID,
    body: CorrectionIn,
    me: CurrentUser,
    session: SessionDep,
    limiter: LimiterDep,
    push: PushDep,
) -> CorrectionOut:
    """Ask the hostel office to fix an outing: a forgotten tap-in, a wrong tap. The office
    decides; nothing changes until they approve."""
    await enforce(limiter, "correction:user", str(me.id), CORRECTION_ASKS)
    name = me.name
    try:
        out = await corrections.ask(session, me, outing_id, body)
    except corrections.Refused as e:
        raise HTTPException(e.status, detail=e.message) from None
    outing = await session.get(Outing, outing_id)
    assert outing is not None
    for person in await staff.office_for(session, outing.hostel_id):
        push.to_user(
            person.id,
            PushMessage(
                title="Outing correction asked",
                body=f"{name} asked the office to correct an outing.",
                url="/office/corrections",
                channel="share-status",  # the app's "Sharing and requests" switch
            ),
        )
    return out


@router.patch("/current", deprecated=True)
async def extend(_me: CurrentUser) -> OutingOut:
    """Return times are fixed by the hostel's rules (POST /current/running-late moves one once,
    within a cap); kept so older apps get a clear answer. Whatever body an older app sends is
    ignored (never read, so never a validation error)."""
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
    sender: OutboxDep,
) -> OutingOut:
    returned = await svc.mark_return(
        session, me.id, pepper=settings.code_pepper.get_secret_value(), web_url=sender.web_url
    )
    if returned is None:
        raise NOT_OUT
    sender.send_now(returned.alerts)
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
    page = await svc.history(session, me.id, limit=limit, before=before)
    await _with_corrections(session, page.items)
    return page


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
        again=await requests.is_again(session, r),
    )


@router.get("/request")
async def todays_request(me: CurrentUser, session: SessionDep) -> OutingRequestOut | None:
    r = await requests.latest_today(session, me.id, rules.ist_date(datetime.now(UTC)))
    return await _request_out(session, r) if r else None


@router.post("/request", status_code=status.HTTP_201_CREATED)
async def send_request(
    body: OutingRequestIn,
    me: CurrentUser,
    session: SessionDep,
    push: PushDep,
    limiter: LimiterDep,
) -> OutingRequestOut:
    await enforce(limiter, "request:user", str(me.id), REQUESTS_MADE)
    name, hostel_id = me.name, me.hostel_id  # readable even if create() rolls back
    try:
        r = await requests.create(session, me, body)
    except rules.Refused as e:
        raise refused(e) from None
    except requests.AlreadyRequested:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="You already asked for today's outing. Cancel it first to change it.",
        ) from None
    out = await _request_out(session, r)
    # The hostel's wardens (or the admins, if it has none) decide it: tell them now.
    asked = "another outing today" if out.again else "today's outing"
    for person in await staff.office_for(session, hostel_id):
        push.to_user(
            person.id,
            PushMessage(
                title="New outing request",
                body=f"{name} asked for {asked}.",
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
