"""Outings: check out, return, history, summary.

The outing rules (app/services/rules.py) decide whether a student may go out and when they must
be back; the return time never changes afterwards (no extensions). Leaving and returning use the
database clock (a client cannot backdate them). Status is derived: returned if returned_at is
set, overdue if now is past expected_return_at, otherwise out.
"""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Outing, RequestStatus, User, Via
from app.schemas import OutingCreateIn, OutingOut, OutingPage, OutingSummary
from app.services import requests, rules

MIN_AHEAD = rules.MIN_AHEAD


class AlreadyOut(Exception):
    pass


def status_of(outing: Outing, now: datetime) -> str:
    if outing.returned_at is not None:
        return "returned"
    return "overdue" if now > outing.expected_return_at else "out"


def _minutes(delta: timedelta) -> int:
    return max(0, int(delta.total_seconds() // 60))


def to_out(outing: Outing, now: datetime) -> OutingOut:
    end = outing.returned_at or now
    return OutingOut(
        id=outing.id,
        destination=outing.destination,
        purpose=outing.purpose,
        left_at=outing.left_at,
        expected_return_at=outing.expected_return_at,
        returned_at=outing.returned_at,
        status=status_of(outing, now),  # type: ignore[arg-type]
        late_minutes=_minutes(end - outing.expected_return_at),
        duration_minutes=(
            _minutes(outing.returned_at - outing.left_at) if outing.returned_at else None
        ),
        out_via=outing.out_via.value,
        in_via=outing.in_via.value if outing.in_via else None,
        late_reply=outing.late_reply.value if outing.late_reply else None,
    )


async def _no_request(session: AsyncSession, student_id: uuid.UUID, window: rules.Window) -> str:
    """Why a form day refuses the tap-out, by the state of today's request."""
    later = (
        f" From {rules.clock(window.no_form_from)} you can go out without one."
        if window.no_form_from
        else ""
    )
    latest = await requests.latest_today(session, student_id, window.day)
    status = latest.status if latest else None
    if status is RequestStatus.PENDING:
        return "Your request for today is waiting for the hostel office's approval."
    if status is RequestStatus.DECLINED:
        return "Your request for today was declined. You can send a new one."
    if status is RequestStatus.APPROVED:  # not usable: already used for an outing
        return f"You've used today's approved outing. Form days allow one outing a day.{later}"
    return (
        f"{window.label} outings need an approved request. Ask for today's outing in Lumiback "
        f"(Today in the app, Home on the website), then tap out once it's approved.{later}"
    )


async def check_out(
    session: AsyncSession,
    student: User,
    body: OutingCreateIn,
    *,
    gate_id: uuid.UUID | None = None,
    commit: bool = True,
) -> Outing:
    """Opens an outing if today's rules allow it (raises rules.Refused otherwise). `gate_id`:
    tapped out at that gate (otherwise logged in the app). `commit=False` leaves the commit to
    the caller, so a gate scan saves atomically."""
    now = datetime.now(UTC)
    window = await rules.today_window(session, student, now)
    request = None
    if window.needs_form:
        # Used even in the no-form evening, so an approved request is marked as used.
        request = await requests.usable_today(session, student.id, window.day)
        if request is None and window.form_needed_at(now):
            raise rules.Refused(await _no_request(session, student.id, window))
    expected = rules.return_time(
        window,
        now,
        requested_minutes=request.requested_minutes if request else None,
    )
    outing = Outing(
        student_id=student.id,
        destination=body.destination,
        purpose=body.purpose or (request.purpose if request else None),
        # left_at and returned_at both come from the database clock (server_default /
        # now()), so app/DB clock skew can never make a return look earlier than leaving.
        expected_return_at=expected,
        out_via=Via.GATE if gate_id else Via.SELF,
        out_gate_id=gate_id,
        request_id=request.id if request else None,
    )
    session.add(outing)
    try:
        if commit:
            await session.commit()
        else:
            await session.flush()
    except IntegrityError:
        await session.rollback()
        raise AlreadyOut from None
    await session.refresh(outing)  # load left_at set by the database
    return outing


async def current(session: AsyncSession, student_id: uuid.UUID) -> Outing | None:
    return (
        await session.execute(
            select(Outing).where(Outing.student_id == student_id, Outing.returned_at.is_(None))
        )
    ).scalar_one_or_none()


async def mark_return(
    session: AsyncSession,
    student_id: uuid.UUID,
    *,
    gate_id: uuid.UUID | None = None,
    commit: bool = True,
) -> Outing | None:
    """Atomic: two simultaneous 'I'm back' taps (or scans) close the outing once."""
    returned = (
        await session.execute(
            update(Outing)
            .where(Outing.student_id == student_id, Outing.returned_at.is_(None))
            .values(
                returned_at=func.now(),
                in_via=Via.GATE if gate_id else Via.SELF,
                in_gate_id=gate_id,
            )
            .returning(Outing)
        )
    ).scalar_one_or_none()
    if commit:
        await session.commit()
    return returned


async def history(
    session: AsyncSession, student_id: uuid.UUID, *, limit: int, before: datetime | None
) -> OutingPage:
    query = select(Outing).where(Outing.student_id == student_id)
    if before is not None:
        query = query.where(Outing.left_at < before)
    rows = list(
        (await session.execute(query.order_by(Outing.left_at.desc()).limit(limit + 1))).scalars()
    )
    now = datetime.now(UTC)
    page = rows[:limit]
    return OutingPage(
        items=[to_out(o, now) for o in page],
        next_before=page[-1].left_at if len(rows) > limit else None,
    )


async def summary(session: AsyncSession, student_id: uuid.UUID) -> OutingSummary:
    total, returned, late = (
        await session.execute(
            select(
                func.count(),
                func.count(Outing.returned_at),
                func.count().filter(Outing.returned_at > Outing.expected_return_at),
            ).where(Outing.student_id == student_id)
        )
    ).one()
    open_outing = await current(session, student_id)
    currently = "in" if open_outing is None else status_of(open_outing, datetime.now(UTC))
    return OutingSummary(
        total=total,
        returned=returned,
        returned_late=late,
        on_time_rate=round((returned - late) / returned, 3) if returned else None,
        currently=currently,  # type: ignore[arg-type]
    )
