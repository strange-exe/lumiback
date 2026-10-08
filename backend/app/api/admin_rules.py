"""Admin: outing rule sets, hostels, holidays, today's weekend/holiday requests, and
escalations for late students who didn't answer the app's alert."""

import uuid
from datetime import UTC, date, datetime, time
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import AdminUser, PushDep, SessionDep
from app.models import DayRule, DayType, Holiday, Hostel, OutingRequest, RuleSet, User
from app.push import PushMessage
from app.schemas import (
    AdminRequestOut,
    DayRuleIO,
    EscalationOut,
    EscalationResolveIn,
    HolidayIO,
    HostelIn,
    HostelOut,
    RequestDecisionIn,
    RuleSetIn,
    RuleSetOut,
)
from app.services import admin as audit_svc
from app.services import escalations, requests, rules
from app.services.gates import campus_settings

router = APIRouter(prefix="/admin", tags=["admin"])

NOT_FOUND = HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found")


def _clock(value: str) -> time:
    hours, minutes = (int(x) for x in value.split(":"))
    return time(hours, minutes)


def _hhmm(value: time | None) -> str | None:
    return value.strftime("%H:%M") if value else None


# ---------- weekend / holiday requests ----------


async def _request_out(session, r: OutingRequest, student: User) -> AdminRequestOut:
    hostel = await session.get(Hostel, student.hostel_id) if student.hostel_id else None
    decider = await session.get(User, r.decided_by) if r.decided_by else None
    try:
        limit = (await rules.today_window(session, student, datetime.now(UTC))).max_minutes
    except rules.Refused:
        limit = None
    return AdminRequestOut(
        id=r.id,
        student_id=student.id,
        name=student.name,
        email=student.email,
        roll_no=student.roll_no,
        hostel=hostel.name if hostel else None,
        day=r.day,
        purpose=r.purpose,
        phone=r.phone,
        emergency_name=r.emergency_name,
        emergency_relation=r.emergency_relation,
        emergency_phone=r.emergency_phone,
        requested_minutes=r.requested_minutes,
        max_minutes=limit,
        status=r.status.value,
        note=r.note,
        decided_by=decider.name if decider else None,
        decided_at=r.decided_at,
        created_at=r.created_at,
        used=await requests.is_used(session, r.id),
    )


@router.get("/requests")
async def list_requests(
    _: AdminUser, session: SessionDep, day: date | None = None
) -> list[AdminRequestOut]:
    """A day's requests (today by default): pending first, oldest first."""
    rows = await requests.queue(session, day or rules.ist_date(datetime.now(UTC)))
    return [await _request_out(session, r, u) for r, u in rows]


@router.post("/requests/{request_id}/decision")
async def decide_request(
    request_id: uuid.UUID,
    body: RequestDecisionIn,
    me: AdminUser,
    session: SessionDep,
    push: PushDep,
) -> AdminRequestOut:
    try:
        r = await requests.decide(session, me, request_id, approve=body.approve, note=body.note)
    except requests.NotFound:
        raise NOT_FOUND from None
    except requests.NotPending:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="This request was already decided or cancelled"
        ) from None
    student = await session.get(User, r.student_id)
    assert student is not None
    audit_svc.audit(
        session, me, f"request:{'approve' if body.approve else 'decline'}", student.email
    )
    await session.commit()
    push.to_user(
        student.id,
        PushMessage(
            title="Outing approved" if body.approve else "Outing request declined",
            body=(
                "Scan at the gate when you leave."
                if body.approve
                else (body.note or "Ask the hostel office if you have questions.")
            ),
            url="/today",
            channel="share-status",
        ),
    )
    return await _request_out(session, r, student)


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
                        late_until=_hhmm(d.late_until),
                        max_minutes=d.max_minutes,
                        needs_form=d.needs_form,
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
            late_until=_clock(d.late_until) if d.late_until else None,
            max_minutes=d.max_minutes,
            needs_form=d.needs_form,
        )
        for d in days
    ]


NAME_TAKEN = HTTPException(status.HTTP_409_CONFLICT, detail="That name is already used")


@router.get("/rule-sets")
async def list_rule_sets(_: AdminUser, session: SessionDep) -> list[RuleSetOut]:
    return await _rule_sets_out(session)


@router.post("/rule-sets", status_code=status.HTTP_201_CREATED)
async def create_rule_set(body: RuleSetIn, me: AdminUser, session: SessionDep) -> list[RuleSetOut]:
    rule_set = RuleSet(name=body.name)
    session.add(rule_set)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise NAME_TAKEN from None
    session.add_all(_apply_days(rule_set.id, body.days))
    audit_svc.audit(session, me, "rules:create", body.name)
    await session.commit()
    return await _rule_sets_out(session)


@router.put("/rule-sets/{rule_set_id}")
async def update_rule_set(
    rule_set_id: uuid.UUID, body: RuleSetIn, me: AdminUser, session: SessionDep
) -> list[RuleSetOut]:
    rule_set = await session.get(RuleSet, rule_set_id)
    if rule_set is None:
        raise NOT_FOUND
    rule_set.name = body.name
    await session.execute(delete(DayRule).where(DayRule.rule_set_id == rule_set_id))
    session.add_all(_apply_days(rule_set_id, body.days))
    audit_svc.audit(session, me, "rules:update", body.name)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise NAME_TAKEN from None
    return await _rule_sets_out(session)


@router.post("/rule-sets/{rule_set_id}/default")
async def make_default(
    rule_set_id: uuid.UUID, me: AdminUser, session: SessionDep
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
    rule_set_id: uuid.UUID, me: AdminUser, session: SessionDep
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
async def list_hostels(_: AdminUser, session: SessionDep) -> list[HostelOut]:
    return await _hostels_out(session)


@router.post("/hostels", status_code=status.HTTP_201_CREATED)
async def create_hostel(body: HostelIn, me: AdminUser, session: SessionDep) -> list[HostelOut]:
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
    hostel_id: uuid.UUID, body: HostelIn, me: AdminUser, session: SessionDep
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
    hostel_id: uuid.UUID, me: AdminUser, session: SessionDep
) -> list[HostelOut]:
    """Its students go back to the default rules until they pick another hostel."""
    hostel = await session.get(Hostel, hostel_id)
    if hostel is None:
        raise NOT_FOUND
    await session.delete(hostel)
    audit_svc.audit(session, me, "hostel:delete", hostel.name)
    await session.commit()
    return await _hostels_out(session)


# ---------- holidays ----------


@router.get("/holidays")
async def list_holidays(
    _: AdminUser, session: SessionDep, year: Annotated[int | None, Query(ge=2020, le=2100)] = None
) -> list[HolidayIO]:
    query = select(Holiday).order_by(Holiday.day)
    if year is not None:
        query = query.where(Holiday.day >= date(year, 1, 1), Holiday.day <= date(year, 12, 31))
    return [HolidayIO(day=h.day, name=h.name) for h in (await session.execute(query)).scalars()]


@router.put("/holidays/{day}")
async def put_holiday(day: date, body: HolidayIO, me: AdminUser, session: SessionDep) -> HolidayIO:
    if body.day != day:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Dates don't match")
    holiday = await session.get(Holiday, day)
    if holiday is None:
        session.add(Holiday(day=day, name=body.name))
    else:
        holiday.name = body.name
    audit_svc.audit(session, me, "holiday:set", f"{day} {body.name}")
    await session.commit()
    return body


@router.delete("/holidays/{day}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_holiday(day: date, me: AdminUser, session: SessionDep) -> None:
    holiday = await session.get(Holiday, day)
    if holiday is None:
        raise NOT_FOUND
    await session.delete(holiday)
    audit_svc.audit(session, me, "holiday:delete", f"{day} {holiday.name}")
    await session.commit()


# ---------- escalations (late students who didn't answer the alert) ----------


@router.get("/escalations")
async def list_escalations(
    me: AdminUser, session: SessionDep, state: Literal["open", "all"] = "open"
) -> list[EscalationOut]:
    """Reading a student's live position here is logged on their share's access log."""
    return await escalations.listing(session, me, open_only=state == "open")


@router.post("/escalations/{escalation_id}/resolve", status_code=status.HTTP_204_NO_CONTENT)
async def resolve_escalation(
    escalation_id: uuid.UUID, body: EscalationResolveIn, me: AdminUser, session: SessionDep
) -> None:
    try:
        await escalations.resolve(session, me, escalation_id, body.note)
    except escalations.NotFound:
        raise NOT_FOUND from None
    audit_svc.audit(session, me, "escalation:resolve", str(escalation_id))
    await session.commit()
