"""Outing corrections: a forgotten tap-in, a wrong tap, a return the gate never saw.

Nobody changes a time on their own say-so except the hostel office:
- Staff covering the outing's hostel correct it directly, with a reason (`by_staff`).
- A student only asks (`ask`). Staff covering the hostel approve or decline (`decide`), and an
  approval applies the change then.

Every change is an `OutingCorrection` row that keeps what the record said before, and the
office's changes are also in the admin audit log. Kinds:
- return: they came back at a stated time (closes an open outing, ending safe return as a
  normal return does);
- return_time: a closed outing ended at a different time;
- cancel: the tap was a mistake and there was no trip (`returned_at = left_at`).

A correction is applied to the outing as it is when applied: a "return" asked while out,
approved after the student tapped in, changes that return's time.

Lock order, as everywhere else: correction rows, then the safe-return share, then the outing
(`outings.mark_return` takes the last two).
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import ColumnElement, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    CorrectionKind,
    Gate,
    Hostel,
    InVia,
    Outing,
    OutingCorrection,
    RequestStatus,
    User,
)
from app.schemas import AdminOuting, CorrectionAsk, CorrectionIn, CorrectionOut, CorrectionQueue
from app.services import outings, safe_return
from app.services.admin import CORRECTABLE_FOR, _register_row, audit
from app.services.rules import IST, clock
from app.services.staff import Staff

# A student can ask about their open outing, or one that ended this recently.
STUDENT_CAN_ASK_FOR = timedelta(days=7)


class Refused(Exception):
    """`status` and the message go back to the caller."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def _not_found() -> Refused:
    return Refused(404, "Outing not found")


def to_out(c: OutingCorrection) -> CorrectionOut:
    return CorrectionOut(
        id=c.id,
        kind=c.kind.value,
        status=c.status.value,
        returned_at=c.returned_at,
        reason=c.reason,
        by_staff=c.by_staff,
        old_returned_at=c.old_returned_at,
        note=c.note,
        created_at=c.created_at,
    )


async def latest(
    session: AsyncSession, outing_ids: list[uuid.UUID]
) -> dict[uuid.UUID, CorrectionOut]:
    """The newest correction of each outing that has one."""
    if not outing_ids:
        return {}
    rows = await session.scalars(
        select(OutingCorrection)
        .where(OutingCorrection.outing_id.in_(outing_ids))
        .order_by(OutingCorrection.created_at, OutingCorrection.id)
    )
    return {c.outing_id: to_out(c) for c in rows}  # later rows replace earlier ones


def _when(t: datetime) -> str:
    """'7:40 PM' today, or 'Tue 4 Nov, 7:40 PM' (IST)."""
    local = t.astimezone(IST)
    return f"{local:%a} {local.day} {local:%b}, {clock(local)}"


def _check_kind(kind: CorrectionKind, outing: Outing) -> None:
    if kind is CorrectionKind.RETURN and outing.returned_at is not None:
        raise Refused(409, "This outing has already ended. Change its return time instead.")
    if kind is CorrectionKind.RETURN_TIME and outing.returned_at is None:
        raise Refused(409, "This outing hasn't ended yet. Record the return instead.")


async def _check_time(session: AsyncSession, outing: Outing, t: datetime, now: datetime) -> None:
    if t < outing.left_at:
        raise Refused(422, f"The outing began at {_when(outing.left_at)}. Pick a later time.")
    if t > now:
        raise Refused(422, "That time hasn't come yet. Choose a time up to now.")
    following = await session.scalar(
        select(func.min(Outing.left_at)).where(
            Outing.student_id == outing.student_id, Outing.left_at > outing.left_at
        )
    )
    if following is not None and t > following:
        raise Refused(
            422,
            f"Their next outing started at {_when(following)}. Choose a time before that.",
        )


async def _apply(
    session: AsyncSession,
    outing: Outing,
    kind: CorrectionKind,
    t: datetime | None,
    pepper: str,
) -> tuple[datetime | None, InVia | None, safe_return.Back | None]:
    """Change the record. Returns what it said before, and the safe-return share it ended
    (for the caller to tell the contact after commit, as any return does)."""
    old_returned, old_via = outing.returned_at, outing.in_via
    when = outing.left_at if kind is CorrectionKind.CANCEL else t
    assert when is not None  # CorrectionIn and the table's check require a time
    back = None
    if old_returned is None:
        closed = await outings.mark_return(
            session, outing.student_id, pepper=pepper, commit=False, at=when, via=InVia.STAFF
        )
        if closed is None or closed.outing.id != outing.id:
            raise Refused(409, "This outing just ended. Reload and try again.")
        back = closed.back
    else:
        await session.execute(
            update(Outing)
            .where(Outing.id == outing.id)
            .values(returned_at=when, in_via=InVia.STAFF)
        )
    return old_returned, old_via, back


@dataclass(frozen=True)
class Corrected:
    outing: AdminOuting  # the register row as it is now
    student_id: uuid.UUID
    back: safe_return.Back | None


async def by_staff(
    session: AsyncSession, staff: Staff, outing_id: uuid.UUID, body: CorrectionIn, pepper: str
) -> Corrected:
    """Apply a correction now."""
    now = datetime.now(UTC)
    outing = await session.get(Outing, outing_id)
    if outing is None or not staff.covers_hostel(outing.hostel_id):
        raise _not_found()
    if outing.left_at < now - CORRECTABLE_FOR:
        raise Refused(409, "Outings older than 30 days can't be changed.")
    kind = CorrectionKind(body.kind)
    _check_kind(kind, outing)
    if body.returned_at is not None and kind is not CorrectionKind.CANCEL:
        await _check_time(session, outing, body.returned_at, now)
    # A student's open question about this outing is answered by this change (and locking it
    # first keeps the lock order of `decide`).
    await session.execute(
        update(OutingCorrection)
        .where(
            OutingCorrection.outing_id == outing.id,
            OutingCorrection.status == RequestStatus.PENDING,
        )
        .values(
            status=RequestStatus.CANCELLED,
            decided_by=staff.user.id,
            decided_at=now,
            note="The hostel office corrected this outing.",
        )
    )
    old_returned, old_via, back = await _apply(session, outing, kind, body.returned_at, pepper)
    session.add(
        OutingCorrection(
            outing_id=outing.id,
            kind=kind,
            status=RequestStatus.APPROVED,
            returned_at=None if kind is CorrectionKind.CANCEL else body.returned_at,
            reason=body.reason,
            old_returned_at=old_returned,
            old_in_via=old_via,
            asked_by=staff.user.id,
            by_staff=True,
            decided_by=staff.user.id,
            decided_at=now,
        )
    )
    student = await session.get(User, outing.student_id)
    assert student is not None  # outings are deleted with their student
    audit(session, staff.user, f"outing:{kind.value}", student.email)
    student_id = student.id
    await session.commit()
    rows = await _register(session, Outing.id == outing_id, staff)
    return Corrected(rows[0], student_id, back)


async def ask(
    session: AsyncSession, student: User, outing_id: uuid.UUID, body: CorrectionIn
) -> CorrectionOut:
    """A student asks the office to correct one of their outings."""
    now = datetime.now(UTC)
    outing = await session.get(Outing, outing_id)
    if outing is None or outing.student_id != student.id:
        raise _not_found()
    ended = outing.returned_at
    if ended is not None and ended < now - STUDENT_CAN_ASK_FOR:
        raise Refused(
            409,
            "You can ask about outings from the last 7 days. "
            "For older ones, talk to the hostel office.",
        )
    kind = CorrectionKind(body.kind)
    _check_kind(kind, outing)
    if body.returned_at is not None and kind is not CorrectionKind.CANCEL:
        await _check_time(session, outing, body.returned_at, now)
    correction = OutingCorrection(
        outing_id=outing.id,
        kind=kind,
        status=RequestStatus.PENDING,
        returned_at=None if kind is CorrectionKind.CANCEL else body.returned_at,
        reason=body.reason,
        asked_by=student.id,
        by_staff=False,
    )
    session.add(correction)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise Refused(
            409, "You've already asked about this outing. The hostel office will reply."
        ) from None
    await session.commit()
    await session.refresh(correction)
    return to_out(correction)


@dataclass(frozen=True)
class Decided:
    correction: CorrectionOut
    student_id: uuid.UUID
    back: safe_return.Back | None


async def decide(
    session: AsyncSession,
    staff: Staff,
    correction_id: uuid.UUID,
    approve: bool,
    note: str | None,
    pepper: str,
) -> Decided:
    correction = await session.get(OutingCorrection, correction_id, with_for_update=True)
    if correction is None:
        raise Refused(404, "Request not found")
    outing = await session.get(Outing, correction.outing_id)
    assert outing is not None  # corrections are deleted with their outing
    if not staff.covers_hostel(outing.hostel_id):
        raise Refused(404, "Request not found")
    if correction.status is not RequestStatus.PENDING:
        raise Refused(409, "This was already answered.")
    now = datetime.now(UTC)
    back = None
    if approve:
        if correction.returned_at is not None:
            await _check_time(session, outing, correction.returned_at, now)
        correction.old_returned_at, correction.old_in_via, back = await _apply(
            session, outing, correction.kind, correction.returned_at, pepper
        )
    correction.status = RequestStatus.APPROVED if approve else RequestStatus.DECLINED
    correction.decided_by = staff.user.id
    correction.decided_at = now
    correction.note = note or None
    student = await session.get(User, outing.student_id)
    assert student is not None
    audit(session, staff.user, f"correction:{'approve' if approve else 'decline'}", student.email)
    decided = Decided(to_out(correction), student.id, back)
    await session.commit()
    return decided


async def _register(
    session: AsyncSession, where: ColumnElement[bool], staff: Staff, limit: int = 200
) -> list[AdminOuting]:
    now = datetime.now(UTC)
    rows = await session.execute(
        select(Outing, User, Gate.name, Hostel.name)
        .join(User, User.id == Outing.student_id)
        .outerjoin(Gate, Gate.id == Outing.out_gate_id)
        .outerjoin(Hostel, Hostel.id == Outing.hostel_id)
        .where(where, staff.covers(Outing.hostel_id))
        .order_by(Outing.left_at.desc())
        .limit(limit)
        .execution_options(populate_existing=True)
    )
    return [_register_row(o, u, gate, hostel, now) for o, u, gate, hostel in rows]


async def queue(session: AsyncSession, staff: Staff) -> CorrectionQueue:
    """What the office has to look at: students' asks (oldest first), and returns the gate
    never saw (closed when the student tapped out again on a later day)."""
    since = datetime.now(UTC) - CORRECTABLE_FOR
    pending = list(
        await session.scalars(
            select(OutingCorrection)
            .join(Outing, Outing.id == OutingCorrection.outing_id)
            .where(
                OutingCorrection.status == RequestStatus.PENDING,
                staff.covers(Outing.hostel_id),
            )
            .order_by(OutingCorrection.created_at)
            .limit(200)
        )
    )
    rows = await _register(
        session, Outing.id.in_([c.outing_id for c in pending]), staff, limit=len(pending) or 1
    )
    by_id = {r.id: r for r in rows}
    unrecorded = await _register(
        session, (Outing.in_via == InVia.UNRECORDED) & (Outing.left_at >= since), staff
    )
    return CorrectionQueue(
        asks=[
            CorrectionAsk(correction=to_out(c), outing=by_id[c.outing_id])
            for c in pending
            if c.outing_id in by_id
        ],
        unrecorded=unrecorded,
    )
