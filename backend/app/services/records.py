"""One student's record for the hostel office: their outings (each with its corrections and
late follow-up), their weekend/holiday requests and their gate scans, newest first, a page at a
time.

Scoped exactly like the office's other reads: the student must be one the staff member looks
after (a warden: a student living in one of their hostels; else 404, as if they didn't exist).
Outings then count for the hostel they happened in (Outing.hostel_id), as on the register, so a
warden doesn't see trips a student made from another hostel before moving in. Requests and
scans follow the student, as on the Requests and Scans pages.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Escalation,
    Gate,
    Hostel,
    Outing,
    OutingCorrection,
    OutingRequest,
    User,
    UserRole,
)
from app.schemas import RecordEscalation, RecordOuting, RecordOutingPage, StudentRecordOut
from app.services import admin as office
from app.services.corrections import to_out
from app.services.staff import Staff


class NotFound(Exception):
    """No such student, not a student, or not one this staff member looks after."""


async def student_in_scope(session: AsyncSession, staff: Staff, student_id: uuid.UUID) -> User:
    student = await session.get(User, student_id)
    if student is None or student.role != UserRole.STUDENT or not staff.covers_student(student):
        raise NotFound
    return student


async def header(session: AsyncSession, staff: Staff, student: User) -> StudentRecordOut:
    """Who they are (with the contacts the office may need) and their record in numbers."""
    now = datetime.now(UTC)
    hostel = await session.get(Hostel, student.hostel_id) if student.hostel_id else None
    open_ = await session.scalar(
        select(Outing).where(Outing.student_id == student.id, Outing.returned_at.is_(None))
    )
    mine = (Outing.student_id == student.id, staff.covers(Outing.hostel_id))
    outings = await session.scalar(select(func.count()).select_from(Outing).where(*mine))
    late = await session.scalar(
        select(func.count())
        .select_from(Outing)
        .where(
            *mine,
            or_(
                Outing.returned_at > Outing.expected_return_at,
                (Outing.returned_at.is_(None)) & (Outing.expected_return_at < now),
            ),
        )
    )
    escalations = await session.scalar(
        select(func.count())
        .select_from(Escalation)
        .join(Outing, Outing.id == Escalation.outing_id)
        .where(*mine, Escalation.resolved_at.is_(None))
    )
    requests = await session.scalar(
        select(func.count())
        .select_from(OutingRequest)
        .where(OutingRequest.student_id == student.id)
    )
    return StudentRecordOut(
        student=office._student_out(student, hostel.name if hostel else None, open_, now),
        outings=outings or 0,
        late=late or 0,
        open_escalations=escalations or 0,
        requests=requests or 0,
    )


async def outings(
    session: AsyncSession,
    staff: Staff,
    student: User,
    *,
    before: datetime | None,
    limit: int,
) -> RecordOutingPage:
    """Newest first by when they left; `before` (a left_at) pages back. A page never ends inside a
    run of equal left_at times (see _whole_ties), so `< before` can't skip any."""
    base = (
        select(Outing, Gate.name, Hostel.name)
        .outerjoin(Gate, Gate.id == Outing.out_gate_id)
        .outerjoin(Hostel, Hostel.id == Outing.hostel_id)
        .where(Outing.student_id == student.id, staff.covers(Outing.hostel_id))
        .order_by(Outing.left_at.desc(), Outing.id.desc())
    )
    if before is not None:
        base = base.where(Outing.left_at < before)
    rows = list(await session.execute(base.limit(limit + 1)))
    page, more = await _whole_ties(
        session,
        base,
        rows,
        limit,
        at=lambda row: row[0].left_at,
        col=Outing.left_at,
        id_col=Outing.id,
        row_id=lambda row: row[0].id,
    )
    ids = [o.id for o, _, _ in page]
    corrections: dict[uuid.UUID, list] = {i: [] for i in ids}
    escalations: dict[uuid.UUID, RecordEscalation] = {}
    if ids:
        for c in await session.scalars(
            select(OutingCorrection)
            .where(OutingCorrection.outing_id.in_(ids))
            .order_by(OutingCorrection.created_at, OutingCorrection.id)
        ):
            corrections[c.outing_id].append(to_out(c))
        resolver = User.__table__.alias("resolver")
        for e, resolved_by in await session.execute(
            select(Escalation, resolver.c.name)
            .outerjoin(resolver, resolver.c.id == Escalation.resolved_by)
            .where(Escalation.outing_id.in_(ids))
        ):
            escalations[e.outing_id] = RecordEscalation(
                created_at=e.created_at,
                resolved_at=e.resolved_at,
                resolved_by=resolved_by,
                note=e.note,
            )
    now = datetime.now(UTC)
    items = [
        RecordOuting(
            **dict(office._register_row(o, student, gate_name, hostel, now)),
            purpose=o.purpose,
            corrections=corrections[o.id],
            escalation=escalations.get(o.id),
        )
        for o, gate_name, hostel in page
    ]
    return RecordOutingPage(
        items=items,
        next_before=page[-1][0].left_at if more else None,
    )


async def requests(
    session: AsyncSession, student: User, *, before: datetime | None, limit: int
) -> tuple[list[OutingRequest], datetime | None]:
    """Their requests, newest first; `before` (a created_at) pages back, never splitting a tie."""
    base = (
        select(OutingRequest)
        .where(OutingRequest.student_id == student.id)
        .order_by(OutingRequest.created_at.desc(), OutingRequest.id.desc())
    )
    if before is not None:
        base = base.where(OutingRequest.created_at < before)
    rows = list(await session.scalars(base.limit(limit + 1)))
    page, more = await _whole_ties(
        session,
        base,
        rows,
        limit,
        at=lambda r: r.created_at,
        col=OutingRequest.created_at,
        id_col=OutingRequest.id,
        row_id=lambda r: r.id,
        scalars=True,
    )
    return page, (page[-1].created_at if more else None)


async def _whole_ties(session, base, rows, limit, *, at, col, id_col, row_id, scalars=False):
    """The page (rows[:limit]) and whether older rows remain. The cursor is a time alone, so if
    the first row past the page has the same time as the page's last one, the rest of that tie
    joins the page: otherwise `< before` on the next page would skip it."""
    page = rows[:limit]
    if len(rows) <= limit:
        return page, False
    edge = page[-1]
    if at(rows[limit]) != at(edge):
        return page, True
    same = base.where(col == at(edge), id_col < row_id(edge))
    page += list(await (session.scalars(same) if scalars else session.execute(same)))
    older = (await session.execute(base.where(col < at(edge)).limit(1))).first()
    return page, older is not None
