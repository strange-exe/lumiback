"""Reports (#16, wave 4): per-hostel numbers for a range of IST days, and a weekly trend.

Everything is counted in the database (a handful of GROUP BY ROLLUP queries, the same number
however many outings there are); Python only puts the rows together. Counts only: a report
never names a student. Scoped like the register: an outing, escalation or request belongs to
the hostel the student was in at the time (outings.hostel_id), and a warden sees only theirs.

What counts:
- outings: those that left in the range, except a mistaken tap the office cancelled;
- gate vs self-reported: how each left (a gate scan, or the app or website);
- back and late: returns with a recorded time (not "not recorded": a later tap-out closed
  them, so when they came back isn't known), late when at least a full minute past the due
  time (the moved time, for running late), as on the register;
- escalations: opened in the range; requests: approved or declined, for days in the range;
- running late: outings whose student moved their due time.
"""

import csv
import io
import math
import uuid
from datetime import date, timedelta

from sqlalchemy import Date, and_, case, cast, exists, func, literal, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    CorrectionKind,
    Escalation,
    Hostel,
    InVia,
    Outing,
    OutingCorrection,
    OutingRequest,
    RequestStatus,
    User,
    Via,
)
from app.schemas import Report, ReportHostel, ReportStats, ReportWeek
from app.services.admin import CSV_BOM, IST, _safe, ist_days
from app.services.staff import Staff

DEFAULT_DAYS = 30
MAX_DAYS = 366  # a year, leap or not
NO_HOSTEL = "No hostel"

_EMPTY = {
    "outings": 0,
    "gate_out": 0,
    "self_out": 0,
    "back": 0,
    "returned_late": 0,
    "median": None,
    "escalations": 0,
    "requests_approved": 0,
    "requests_declined": 0,
    "running_late": 0,
}

_cancelled = exists().where(
    OutingCorrection.outing_id == Outing.id,
    OutingCorrection.kind == CorrectionKind.CANCEL,
    OutingCorrection.status == RequestStatus.APPROVED,
)
_back = and_(
    Outing.returned_at.is_not(None),
    or_(Outing.in_via.is_(None), Outing.in_via != InVia.UNRECORDED),
)
_late = and_(_back, Outing.returned_at - Outing.expected_return_at >= timedelta(minutes=1))
_minutes_late = func.floor(
    func.extract("epoch", Outing.returned_at - Outing.expected_return_at) / 60
)


def _counted(staff: Staff, start: date, end: date):  # noqa: ANN202 - a SQL condition
    since, until = ist_days(start, end)
    return and_(
        staff.covers(Outing.hostel_id), Outing.left_at >= since, Outing.left_at < until, ~_cancelled
    )


def _rows(result) -> dict[uuid.UUID | None | str, dict]:  # noqa: ANN001
    """{hostel id (None: no hostel), or "total" for the ROLLUP's grand total: its numbers}."""
    return {("total" if row.total else row.hostel_id): row._asdict() for row in result}


async def _outings(session: AsyncSession, staff: Staff, start: date, end: date) -> dict:
    hostel = Outing.hostel_id
    return _rows(
        await session.execute(
            select(
                hostel.label("hostel_id"),
                func.grouping(hostel).label("total"),
                func.count().label("outings"),
                func.count().filter(Outing.out_via == Via.GATE).label("gate_out"),
                func.count().filter(Outing.out_via == Via.SELF).label("self_out"),
                func.count().filter(_back).label("back"),
                func.count().filter(_late).label("returned_late"),
                # percentile_cont skips NULLs: the median of the late ones only.
                func.percentile_cont(0.5)
                .within_group(case((_late, _minutes_late)))
                .label("median"),
                func.count().filter(Outing.running_late_at.is_not(None)).label("running_late"),
            )
            .where(_counted(staff, start, end))
            .group_by(func.rollup(hostel))
        )
    )


async def _escalations(session: AsyncSession, staff: Staff, start: date, end: date) -> dict:
    since, until = ist_days(start, end)
    hostel = Outing.hostel_id
    return _rows(
        await session.execute(
            select(
                hostel.label("hostel_id"),
                func.grouping(hostel).label("total"),
                func.count().label("escalations"),
            )
            .select_from(Escalation)
            .join(Outing, Outing.id == Escalation.outing_id)
            .where(
                staff.covers(hostel), Escalation.created_at >= since, Escalation.created_at < until
            )
            .group_by(func.rollup(hostel))
        )
    )


async def _requests(session: AsyncSession, staff: Staff, start: date, end: date) -> dict:
    # A request's hostel: the outing that used it (its hostel then, even none: a student who
    # had no hostel yet), else, never used, the student's now (nothing else to go by). Not a
    # COALESCE: an outing without a hostel must not fall through to where they live today.
    used = select(Outing.id).where(Outing.request_id == OutingRequest.id)
    used_from = (
        select(Outing.hostel_id)
        .where(Outing.request_id == OutingRequest.id)
        .order_by(Outing.left_at)
        .limit(1)
        .scalar_subquery()
    )
    hostel_then = case((used.exists(), used_from), else_=User.hostel_id)
    inner = (
        select(hostel_then.label("hostel_id"), OutingRequest.status)
        .outerjoin(User, User.id == OutingRequest.student_id)
        .where(
            OutingRequest.day >= start,
            OutingRequest.day <= end,
            OutingRequest.status.in_((RequestStatus.APPROVED, RequestStatus.DECLINED)),
        )
        .subquery()
    )
    return _rows(
        await session.execute(
            select(
                inner.c.hostel_id,
                func.grouping(inner.c.hostel_id).label("total"),
                func.count()
                .filter(inner.c.status == RequestStatus.APPROVED)
                .label("requests_approved"),
                func.count()
                .filter(inner.c.status == RequestStatus.DECLINED)
                .label("requests_declined"),
            )
            .where(staff.covers(inner.c.hostel_id))
            .group_by(func.rollup(inner.c.hostel_id))
        )
    )


def _week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


async def _weeks(session: AsyncSession, staff: Staff, start: date, end: date) -> list[ReportWeek]:
    # The Monday of each outing's IST week.
    week = cast(func.date_trunc("week", func.timezone("UTC", Outing.left_at) + literal(IST)), Date)
    counted = {
        row.week: row
        for row in await session.execute(
            select(
                week.label("week"),
                func.count().label("outings"),
                func.count().filter(_late).label("returned_late"),
            )
            .where(_counted(staff, start, end))
            .group_by(week)
        )
    }
    weeks: list[ReportWeek] = []
    monday = _week_start(start)
    while monday <= end:
        inside = min(monday + timedelta(days=6), end) - max(monday, start)
        row = counted.get(monday)
        weeks.append(
            ReportWeek(
                week_start=monday,
                days=inside.days + 1,
                outings=row.outings if row else 0,
                returned_late=row.returned_late if row else 0,
            )
        )
        monday += timedelta(days=7)
    return weeks


def _stats(*parts: dict | None) -> ReportStats:
    merged = dict(_EMPTY)
    for part in parts:
        if part:
            merged.update({k: v for k, v in part.items() if k in _EMPTY})
    back, late, median = merged.pop("back"), merged["returned_late"], merged.pop("median")
    return ReportStats(
        **merged,
        back=back,
        late_rate=late / back if back else None,
        # Half a minute rounds up, as people count.
        median_minutes_late=math.floor(median + 0.5) if median is not None else None,
    )


async def build(session: AsyncSession, staff: Staff, start: date, end: date) -> Report:
    hostels = (
        await session.execute(
            select(Hostel.id, Hostel.name).where(staff.covers(Hostel.id)).order_by(Hostel.name)
        )
    ).all()
    outings = await _outings(session, staff, start, end)
    escalations = await _escalations(session, staff, start, end)
    requests = await _requests(session, staff, start, end)
    rows = [
        ReportHostel(
            hostel_id=hostel_id,
            hostel=name,
            **_stats(
                outings.get(hostel_id), escalations.get(hostel_id), requests.get(hostel_id)
            ).model_dump(),
        )
        for hostel_id, name in hostels
    ]
    # Students who hadn't chosen a hostel: a row of their own, only when there is something
    # in it (only every-hostel staff can see it: a warden's scope never covers no hostel).
    if any(None in part for part in (outings, escalations, requests)):
        none = _stats(outings.get(None), escalations.get(None), requests.get(None))
        rows.append(ReportHostel(hostel_id=None, hostel=NO_HOSTEL, **none.model_dump()))
    return Report(
        start=start,
        end=end,
        every_hostel=staff.every_hostel,
        hostels=rows,
        total=_stats(outings.get("total"), escalations.get("total"), requests.get("total")),
        weeks=await _weeks(session, staff, start, end),
    )


CSV_COLUMNS = (
    "Hostel",
    "Outings",
    "Left through a gate",
    "Logged in the app",
    "Back",
    "Back late",
    "Back late (%)",
    "Median minutes late",
    "Escalations",
    "Requests approved",
    "Requests declined",
    "Running late used",
)


def _csv_row(name: str, s: ReportStats) -> list[object]:
    return [
        _safe(name),  # hostel names are typed by people: no formulas
        s.outings,
        s.gate_out,
        s.self_out,
        s.back,
        s.returned_late,
        "" if s.late_rate is None else math.floor(s.late_rate * 100 + 0.5),
        "" if s.median_minutes_late is None else s.median_minutes_late,
        s.escalations,
        s.requests_approved,
        s.requests_declined,
        s.running_late,
    ]


def to_csv(report: Report) -> str:
    buffer = io.StringIO()
    buffer.write(CSV_BOM)
    writer = csv.writer(buffer)
    writer.writerow(CSV_COLUMNS)
    for row in report.hostels:
        writer.writerow(_csv_row(row.hostel, row))
    writer.writerow(_csv_row(total_label(report), report.total))
    return buffer.getvalue()


def total_label(report: Report) -> str:
    """The total row's name: a warden's total covers only their hostels, not the campus. The
    website says the same (apps/web features/admin/reports.ts totalLabel)."""
    return "All hostels" if report.every_hostel else "Your hostels"
