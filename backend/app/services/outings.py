"""Outings: check out, extend, return, history, summary.

The return time is always the server's clock (a client cannot backdate it). Status is derived:
returned if returned_at is set, overdue if now is past expected_return_at, otherwise out.
"""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Outing, Via
from app.schemas import OutingCreateIn, OutingOut, OutingPage, OutingSummary

MAX_OUTING = timedelta(days=7)
MIN_AHEAD = timedelta(minutes=1)


class AlreadyOut(Exception):
    pass


class InvalidReturnTime(Exception):
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
    )


def _check_return_time(expected: datetime, left_at: datetime, now: datetime) -> None:
    if expected < now + MIN_AHEAD:
        raise InvalidReturnTime("expected return must be in the future")
    if expected > left_at + MAX_OUTING:
        raise InvalidReturnTime(f"an outing can last at most {MAX_OUTING.days} days")


async def check_out(
    session: AsyncSession,
    student_id: uuid.UUID,
    body: OutingCreateIn,
    *,
    gate_id: uuid.UUID | None = None,
    commit: bool = True,
) -> Outing:
    """Opens an outing. `gate_id`: tapped out at that gate (otherwise logged in the app).
    `commit=False` leaves the commit to the caller, so a gate scan saves atomically."""
    now = datetime.now(UTC)
    _check_return_time(body.expected_return_at, now, now)
    outing = Outing(
        student_id=student_id,
        destination=body.destination,
        purpose=body.purpose,
        # left_at and returned_at both come from the database clock (server_default /
        # now()), so app/DB clock skew can never make a return look earlier than leaving.
        expected_return_at=body.expected_return_at,
        out_via=Via.GATE if gate_id else Via.SELF,
        out_gate_id=gate_id,
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


async def extend(session: AsyncSession, student_id: uuid.UUID, expected: datetime) -> Outing | None:
    outing = await current(session, student_id)
    if outing is None:
        return None
    _check_return_time(expected, outing.left_at, datetime.now(UTC))
    outing.expected_return_at = expected
    await session.commit()
    return outing


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
