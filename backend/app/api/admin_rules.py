"""Admin: outing rule sets, hostels, holidays, today's weekend/holiday requests, and
escalations for late students who didn't answer the app's alert."""

import dataclasses
import uuid
from datetime import UTC, date, datetime, time
from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, status
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import (
    HubDep,
    MailerDep,
    PushDep,
    RulesUser,
    SessionDep,
    SettingsDep,
    StaffUser,
    ViewingAsDep,
)
from app.api.outings import safe_return_ended
from app.email_templates import request_decision_email
from app.models import (
    CampusSettings,
    DayRule,
    DayType,
    Holiday,
    Hostel,
    OutingRequest,
    RuleSet,
    User,
    WardenHostel,
)
from app.push import PushMessage
from app.schemas import (
    AdminOuting,
    AdminRequestOut,
    CorrectionDecisionIn,
    CorrectionIn,
    CorrectionOut,
    CorrectionQueue,
    DayRuleIO,
    EscalationOut,
    EscalationResolveIn,
    HolidayIO,
    HostelContactIn,
    HostelIn,
    HostelOut,
    RequestDecisionIn,
    RuleSetIn,
    RuleSetOut,
)
from app.services import admin as audit_svc
from app.services import corrections, escalations, requests, rules
from app.services.gates import campus_settings

router = APIRouter(prefix="/admin", tags=["admin"])

NOT_FOUND = HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found")


def _clock(value: str) -> time:
    hours, minutes = (int(x) for x in value.split(":"))
    return time(hours, minutes)


def _hhmm(value: time | None) -> str | None:
    return value.strftime("%H:%M") if value else None


# ---------- weekend / holiday requests ----------


@dataclasses.dataclass
class _Listing:
    """What a page of requests shares, read once for all its rows (a busy Sunday's queue must
    not cost queries per row): hostel and decider names, used/again, and each day's limit."""

    hostels: dict[uuid.UUID, tuple[str, uuid.UUID]]  # id -> (name, its rule set)
    default_rule_set: uuid.UUID | None  # for students without a hostel
    deciders: dict[uuid.UUID, str]
    used: set[uuid.UUID]
    again: set[uuid.UUID]
    # (rule set, day) -> that day's maximum, read once per rule set and day.
    limits: dict[tuple[uuid.UUID, date], int | None] = dataclasses.field(default_factory=dict)


async def _listing(session, rows: list[tuple[OutingRequest, User]]) -> _Listing:
    hostel_ids = {u.hostel_id for _, u in rows if u.hostel_id}
    hostels = (
        {
            hostel_id: (name, rule_set_id)
            for hostel_id, name, rule_set_id in await session.execute(
                select(Hostel.id, Hostel.name, Hostel.rule_set_id).where(Hostel.id.in_(hostel_ids))
            )
        }
        if hostel_ids
        else {}
    )
    decider_ids = {r.decided_by for r, _ in rows if r.decided_by}
    deciders = (
        {
            user_id: name
            for user_id, name in await session.execute(
                select(User.id, User.name).where(User.id.in_(decider_ids))
            )
        }
        if decider_ids
        else {}
    )
    settings = await session.get(CampusSettings, 1) if rows else None
    default = settings.default_rule_set_id if settings else None
    used, again = await requests.used_and_again(session, [r for r, _ in rows])
    return _Listing(hostels, default, deciders, used, again)


async def _limit(session, student: User, day: date, listing: _Listing) -> int | None:
    """The longest outing the student's rules allow on the request's own day: their hostel's
    rule set, or the campus default (as rules.rule_set_for)."""
    hostel = listing.hostels.get(student.hostel_id) if student.hostel_id else None
    rule_set_id = hostel[1] if hostel else listing.default_rule_set
    if rule_set_id is None:
        return None
    key = (rule_set_id, day)
    if key not in listing.limits:
        rule_set = await session.get(RuleSet, rule_set_id)
        try:
            listing.limits[key] = (
                (await rules.window_in(session, rule_set, day)).max_minutes if rule_set else None
            )
        except rules.Refused:
            listing.limits[key] = None
    return listing.limits[key]


async def _request_out(
    session, r: OutingRequest, student: User, listing: _Listing
) -> AdminRequestOut:
    hostel = listing.hostels.get(student.hostel_id) if student.hostel_id else None
    return AdminRequestOut(
        id=r.id,
        student_id=student.id,
        name=student.name,
        email=student.email,
        roll_no=student.roll_no,
        hostel=hostel[0] if hostel else None,
        day=r.day,
        purpose=r.purpose,
        phone=r.phone,
        emergency_name=r.emergency_name,
        emergency_relation=r.emergency_relation,
        emergency_phone=r.emergency_phone,
        requested_minutes=r.requested_minutes,
        max_minutes=await _limit(session, student, r.day, listing),
        status=r.status.value,
        note=r.note,
        decided_by=listing.deciders.get(r.decided_by) if r.decided_by else None,
        decided_at=r.decided_at,
        created_at=r.created_at,
        used=r.id in listing.used,
        again=r.id in listing.again,
    )


@router.get("/requests")
async def list_requests(
    staff: StaffUser, session: SessionDep, day: date | None = None
) -> list[AdminRequestOut]:
    """A day's requests (today by default): pending first, oldest first."""
    rows = await requests.queue(session, day or rules.ist_date(datetime.now(UTC)), staff)
    listing = await _listing(session, rows)
    return [await _request_out(session, r, u, listing) for r, u in rows]


@router.post("/requests/{request_id}/decision")
async def decide_request(
    request_id: uuid.UUID,
    body: RequestDecisionIn,
    staff: StaffUser,
    session: SessionDep,
    push: PushDep,
) -> AdminRequestOut:
    me = staff.user
    try:
        r = await requests.decide(session, staff, request_id, approve=body.approve, note=body.note)
    except requests.NotFound:
        raise NOT_FOUND from None
    except requests.NotPending:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="This request was already decided or cancelled"
        ) from None
    except requests.OtherDay:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="This request was for another day."
        ) from None
    except requests.DayOver:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Today's outing hours are over, so this can't be approved.",
        ) from None
    student = await session.get(User, r.student_id)
    assert student is not None
    audit_svc.audit(
        session, me, f"request:{'approve' if body.approve else 'decline'}", student.email
    )
    await session.commit()
    web_url = push.web_url
    push.to_user_or_email(
        student.id,
        PushMessage(
            title="Outing approved" if body.approve else "Outing request declined",
            body=(
                "Tap out at the gate when you leave, or log your trip in Lumiback."
                if body.approve
                else (body.note or "Ask the hostel office if you have questions.")
            ),
            url="/today",
            channel="share-status",  # the app's "Sharing and requests" switch
        ),
        lambda user: request_decision_email(
            to=user.email,
            name=user.name,
            approved=body.approve,
            note=body.note,
            web_url=web_url,
        ),
    )
    return await _request_out(session, r, student, await _listing(session, [(r, student)]))


# ---------- rule sets ----------


async def _rule_sets_out(session) -> list[RuleSetOut]:
    settings = await campus_settings(session)
    hostels = (await session.execute(select(Hostel.rule_set_id, Hostel.name))).all()
    out = []
    for rule_set, days in await rules.rule_sets(session):
        out.append(
            RuleSetOut(
                id=rule_set.id,
                name=rule_set.name,
                is_default=settings.default_rule_set_id == rule_set.id,
                hostels=sorted(name for set_id, name in hostels if set_id == rule_set.id),
                days=[
                    DayRuleIO(
                        day_type=d.day_type.value,
                        opens_at=_hhmm(d.opens_at),
                        return_by=_hhmm(d.return_by),
                        max_minutes=d.max_minutes,
                        needs_form=d.needs_form,
                        no_form_from=_hhmm(d.no_form_from) if d.no_form_from else None,
                    )
                    for d in days
                ],
            )
        )
    return out


def _apply_days(rule_set_id: uuid.UUID, days: list[DayRuleIO]) -> list[DayRule]:
    return [
        DayRule(
            rule_set_id=rule_set_id,
            day_type=DayType(d.day_type),
            opens_at=_clock(d.opens_at),
            return_by=_clock(d.return_by),
            max_minutes=d.max_minutes,
            needs_form=d.needs_form,
            no_form_from=_clock(d.no_form_from) if d.no_form_from else None,
        )
        for d in days
    ]


NAME_TAKEN = HTTPException(status.HTTP_409_CONFLICT, detail="That name is already used")
BAD_RULES = HTTPException(
    status.HTTP_422_UNPROCESSABLE_CONTENT, detail="These rules aren't valid. Check the times."
)


def _rules_conflict(e: IntegrityError) -> HTTPException:
    """A taken name is the admin's to fix; any other constraint means the day rules are off
    (the schema checks them first, so this is a backstop, never a 500)."""
    constraint = getattr(getattr(e.orig, "diag", None), "constraint_name", None)
    return NAME_TAKEN if constraint == "uq_rule_sets_name" else BAD_RULES


@router.get("/rule-sets")
async def list_rule_sets(staff: StaffUser, session: SessionDep) -> list[RuleSetOut]:
    """Every rule set for an admin; for a warden, read-only, just the sets their hostels follow
    (and only their hostels listed under them). Changing rules is admin-only."""
    sets = await _rule_sets_out(session)
    if staff.hostels is None:
        return sets
    mine = (
        await session.execute(
            select(Hostel.rule_set_id, Hostel.name).where(Hostel.id.in_(staff.hostels))
        )
    ).all()
    names = {set_id: sorted(n for s, n in mine if s == set_id) for set_id, _ in mine}
    return [s.model_copy(update={"hostels": names[s.id]}) for s in sets if s.id in names]


@router.post("/rule-sets", status_code=status.HTTP_201_CREATED)
async def create_rule_set(body: RuleSetIn, me: RulesUser, session: SessionDep) -> list[RuleSetOut]:
    rule_set = RuleSet(name=body.name)
    session.add(rule_set)
    try:
        await session.flush()
        session.add_all(_apply_days(rule_set.id, body.days))
        audit_svc.audit(session, me, "rules:create", body.name)
        await session.commit()
    except IntegrityError as e:
        await session.rollback()
        raise _rules_conflict(e) from None
    return await _rule_sets_out(session)


@router.put("/rule-sets/{rule_set_id}")
async def update_rule_set(
    rule_set_id: uuid.UUID, body: RuleSetIn, me: RulesUser, session: SessionDep
) -> list[RuleSetOut]:
    rule_set = await session.get(RuleSet, rule_set_id)
    if rule_set is None:
        raise NOT_FOUND
    rule_set.name = body.name
    try:
        # The delete autoflushes the new name, so a taken name can fail here already.
        await session.execute(delete(DayRule).where(DayRule.rule_set_id == rule_set_id))
        session.add_all(_apply_days(rule_set_id, body.days))
        audit_svc.audit(session, me, "rules:update", body.name)
        await session.commit()
    except IntegrityError as e:
        await session.rollback()
        raise _rules_conflict(e) from None
    return await _rule_sets_out(session)


@router.post("/rule-sets/{rule_set_id}/default")
async def make_default(
    rule_set_id: uuid.UUID, me: RulesUser, session: SessionDep
) -> list[RuleSetOut]:
    rule_set = await session.get(RuleSet, rule_set_id)
    if rule_set is None:
        raise NOT_FOUND
    (await campus_settings(session)).default_rule_set_id = rule_set_id
    audit_svc.audit(session, me, "rules:default", rule_set.name)
    await session.commit()
    return await _rule_sets_out(session)


@router.delete("/rule-sets/{rule_set_id}")
async def delete_rule_set(
    rule_set_id: uuid.UUID, me: RulesUser, session: SessionDep
) -> list[RuleSetOut]:
    rule_set = await session.get(RuleSet, rule_set_id)
    if rule_set is None:
        raise NOT_FOUND
    settings = await campus_settings(session)
    used = await session.scalar(select(func.count()).where(Hostel.rule_set_id == rule_set_id))
    if used or settings.default_rule_set_id == rule_set_id:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Move its hostels to other rules (and pick another default) first",
        )
    await session.delete(rule_set)
    audit_svc.audit(session, me, "rules:delete", rule_set.name)
    await session.commit()
    return await _rule_sets_out(session)


# ---------- hostels ----------


async def _hostels_out(session) -> list[HostelOut]:
    rows = (
        await session.execute(
            select(Hostel, RuleSet.name, func.count(User.id))
            .join(RuleSet, RuleSet.id == Hostel.rule_set_id)
            .outerjoin(User, User.hostel_id == Hostel.id)
            .group_by(Hostel.id, RuleSet.name)
            .order_by(Hostel.name)
        )
    ).all()
    return [
        HostelOut(
            id=h.id,
            name=h.name,
            rule_set_id=h.rule_set_id,
            rule_set=rule_set,
            warden_name=h.warden_name,
            warden_phone=h.warden_phone,
            students=students,
        )
        for h, rule_set, students in rows
    ]


@router.get("/hostels")
async def list_hostels(_: RulesUser, session: SessionDep) -> list[HostelOut]:
    return await _hostels_out(session)


@router.post("/hostels", status_code=status.HTTP_201_CREATED)
async def create_hostel(body: HostelIn, me: RulesUser, session: SessionDep) -> list[HostelOut]:
    if await session.get(RuleSet, body.rule_set_id) is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Unknown rule set")
    session.add(Hostel(**body.model_dump()))
    audit_svc.audit(session, me, "hostel:create", body.name)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise NAME_TAKEN from None
    return await _hostels_out(session)


@router.put("/hostels/{hostel_id}")
async def update_hostel(
    hostel_id: uuid.UUID, body: HostelIn, me: RulesUser, session: SessionDep
) -> list[HostelOut]:
    hostel = await session.get(Hostel, hostel_id)
    if hostel is None:
        raise NOT_FOUND
    if await session.get(RuleSet, body.rule_set_id) is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Unknown rule set")
    for field, value in body.model_dump().items():
        setattr(hostel, field, value)
    audit_svc.audit(session, me, "hostel:update", body.name)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise NAME_TAKEN from None
    return await _hostels_out(session)


@router.delete("/hostels/{hostel_id}")
async def delete_hostel(
    hostel_id: uuid.UUID, me: RulesUser, session: SessionDep
) -> list[HostelOut]:
    """Its students go back to the default rules until they pick another hostel."""
    hostel = await session.get(Hostel, hostel_id)
    if hostel is None:
        raise NOT_FOUND
    # Deleting a hostel also drops its wardens' assignments (the rows cascade), and assigning
    # wardens is an admin's job: a head warden must ask an admin to move the wardens first.
    if not me.is_admin:
        wardens = await session.scalar(
            select(func.count())
            .select_from(WardenHostel)
            .where(WardenHostel.hostel_id == hostel_id)
        )
        if wardens:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail="Wardens look after this hostel. Ask an admin to move them first.",
            )
    await session.delete(hostel)
    audit_svc.audit(session, me, "hostel:delete", hostel.name)
    await session.commit()
    return await _hostels_out(session)


# ---------- holidays ----------


@router.get("/holidays")
async def list_holidays(
    _: StaffUser, session: SessionDep, year: Annotated[int | None, Query(ge=2020, le=2100)] = None
) -> list[HolidayIO]:
    """Campus-wide dates; readable by wardens, changed by admins."""
    query = select(Holiday).order_by(Holiday.day)
    if year is not None:
        query = query.where(Holiday.day >= date(year, 1, 1), Holiday.day <= date(year, 12, 31))
    return [HolidayIO(day=h.day, name=h.name) for h in (await session.execute(query)).scalars()]


def refuse_past(day: date) -> None:
    """Past days already ran under their rules (outings, requests, escalations were judged by
    them): adding, renaming or deleting a holiday there would rewrite history. Today (IST) is
    still allowed."""
    if day < rules.ist_date(datetime.now(UTC)):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, detail="That day has already passed"
        )


@router.put("/holidays/{day}")
async def put_holiday(day: date, body: HolidayIO, me: RulesUser, session: SessionDep) -> HolidayIO:
    if body.day != day:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Dates don't match")
    refuse_past(day)
    holiday = await session.get(Holiday, day)
    if holiday is None:
        session.add(Holiday(day=day, name=body.name))
    else:
        holiday.name = body.name
    audit_svc.audit(session, me, "holiday:set", f"{day} {body.name}")
    await session.commit()
    return body


@router.delete("/holidays/{day}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_holiday(day: date, me: RulesUser, session: SessionDep) -> None:
    refuse_past(day)
    holiday = await session.get(Holiday, day)
    if holiday is None:
        raise NOT_FOUND
    await session.delete(holiday)
    audit_svc.audit(session, me, "holiday:delete", f"{day} {holiday.name}")
    await session.commit()


# ---------- escalations (late students who didn't answer the alert) ----------


@router.get("/escalations")
async def list_escalations(
    staff: StaffUser,
    session: SessionDep,
    viewing_as: ViewingAsDep,
    state: Literal["open", "all"] = "open",
) -> list[EscalationOut]:
    """Reading a student's live position here is logged on their share's access log. A
    developer viewing as a role sees no live positions (nothing to log, nothing shown)."""
    return await escalations.listing(
        session, staff, open_only=state == "open", live_ok=viewing_as is None
    )


@router.post("/escalations/{escalation_id}/resolve", status_code=status.HTTP_204_NO_CONTENT)
async def resolve_escalation(
    escalation_id: uuid.UUID, body: EscalationResolveIn, staff: StaffUser, session: SessionDep
) -> None:
    try:
        await escalations.resolve(session, staff, escalation_id, body.note)
    except escalations.NotFound:
        raise NOT_FOUND from None
    audit_svc.audit(session, staff.user, "escalation:resolve", str(escalation_id))
    await session.commit()


# ---------- outing corrections ----------


def _correction_refused(e: corrections.Refused) -> HTTPException:
    return HTTPException(e.status, detail=e.message)


@router.get("/corrections")
async def correction_queue(staff: StaffUser, session: SessionDep) -> CorrectionQueue:
    """Students' correction asks, and returns the gate never saw, in this office's hostels."""
    return await corrections.queue(session, staff)


@router.post("/outings/{outing_id}/correction")
async def correct_outing(
    outing_id: uuid.UUID,
    body: CorrectionIn,
    staff: StaffUser,
    session: SessionDep,
    settings: SettingsDep,
    push: PushDep,
    hub: HubDep,
    mailer: MailerDep,
    tasks: BackgroundTasks,
) -> AdminOuting:
    """Record a return, fix a return time, or cancel a mistaken tap, with a reason."""
    try:
        done = await corrections.by_staff(
            session, staff, outing_id, body, settings.code_pepper.get_secret_value()
        )
    except corrections.Refused as e:
        raise _correction_refused(e) from None
    await safe_return_ended(done.back, hub=hub, mailer=mailer, tasks=tasks)
    if done.student_id is not None:  # None: a deleted account, nobody to tell
        push.to_user(
            done.student_id,
            PushMessage(
                title="Your outing was updated",
                body="The hostel office corrected one of your outings. See History.",
                url="/history",
                channel="share-status",
            ),
        )
    return done.outing


@router.post("/corrections/{correction_id}/decision")
async def decide_correction(
    correction_id: uuid.UUID,
    body: CorrectionDecisionIn,
    staff: StaffUser,
    session: SessionDep,
    settings: SettingsDep,
    push: PushDep,
    hub: HubDep,
    mailer: MailerDep,
    tasks: BackgroundTasks,
) -> CorrectionOut:
    try:
        done = await corrections.decide(
            session,
            staff,
            correction_id,
            body.approve,
            body.note,
            settings.code_pepper.get_secret_value(),
        )
    except corrections.Refused as e:
        raise _correction_refused(e) from None
    await safe_return_ended(done.back, hub=hub, mailer=mailer, tasks=tasks)
    if done.student_id is not None:  # None: a deleted account, nobody to tell
        push.to_user(
            done.student_id,
            PushMessage(
                title="Correction approved" if body.approve else "Correction declined",
                body=(
                    "The hostel office fixed your outing. See History."
                    if body.approve
                    else (body.note or "Ask the hostel office if you have questions.")
                ),
                url="/history",
                channel="share-status",
            ),
        )
    return done.correction


# ---------- the warden's own hostels ----------


@router.get("/my-hostels")
async def my_hostels(staff: StaffUser, session: SessionDep) -> list[HostelOut]:
    """The hostels this person looks after (every hostel for an admin)."""
    hostels = await _hostels_out(session)
    return [h for h in hostels if staff.hostels is None or h.id in staff.hostels]


@router.patch("/hostels/{hostel_id}/contact")
async def update_hostel_contact(
    hostel_id: uuid.UUID, body: HostelContactIn, staff: StaffUser, session: SessionDep
) -> list[HostelOut]:
    """The warden contact shown on escalations; a warden may change their own hostels' only."""
    hostel = await session.get(Hostel, hostel_id)
    if hostel is None or (staff.hostels is not None and hostel_id not in staff.hostels):
        raise NOT_FOUND
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(hostel, field, value)
    audit_svc.audit(session, staff.user, "hostel:contact", hostel.name)
    await session.commit()
    return await my_hostels(staff, session)
