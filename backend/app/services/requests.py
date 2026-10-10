"""Weekend and holiday outing requests (the outing form).

A student sends the form on the day itself; an admin approves or declines it; an approved request
lets the student tap out once that day, for at most the day's limit (or less, if they asked for
less). The contacts on a request are a snapshot of what the student gave for that outing, and
also become the contacts saved on their profile (they're the student's own, and the latest).
"""

import uuid
from datetime import UTC, date, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Outing, OutingRequest, RequestStatus, User
from app.schemas import OutingRequestIn
from app.services import rules


class AlreadyRequested(Exception):
    """A pending or approved request for today already exists; `used`: it was approved and
    the student already went out on it."""

    def __init__(self, used: bool = False) -> None:
        super().__init__()
        self.used = used


class NotFound(Exception):
    pass


class NotPending(Exception):
    """Only pending requests can be decided; only unused ones cancelled."""


class OtherDay(Exception):
    """Requests are decided on their own day only."""


class DayOver(Exception):
    """Today's outing hours have ended for this student: approving would change nothing."""


async def usable_today(
    session: AsyncSession, student_id: uuid.UUID, day: date
) -> OutingRequest | None:
    """Today's approved request that hasn't been used for an outing yet. Locked until the caller
    commits, so a cancel at the same moment waits and then finds it used (and a request
    cancelled first is no longer approved here)."""
    return (
        await session.execute(
            select(OutingRequest)
            .where(
                OutingRequest.student_id == student_id,
                OutingRequest.day == day,
                OutingRequest.status == RequestStatus.APPROVED,
                ~select(Outing.id).where(Outing.request_id == OutingRequest.id).exists(),
            )
            .limit(1)
            .with_for_update(of=OutingRequest)
        )
    ).scalar_one_or_none()


async def latest_today(
    session: AsyncSession, student_id: uuid.UUID, day: date
) -> OutingRequest | None:
    return (
        await session.execute(
            select(OutingRequest)
            .where(OutingRequest.student_id == student_id, OutingRequest.day == day)
            .order_by(OutingRequest.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def is_used(session: AsyncSession, request_id: uuid.UUID) -> bool:
    return (
        await session.scalar(
            select(select(Outing.id).where(Outing.request_id == request_id).exists())
        )
    ) or False


async def create(session: AsyncSession, student: User, body: OutingRequestIn) -> OutingRequest:
    now = datetime.now(UTC)
    student_id = student.id  # still readable after a rollback expires `student`
    window = await rules.today_window(session, student, now)
    if not window.needs_form:
        raise rules.Refused(f"{window.label} outings don't need a request. Just scan at the gate.")
    if window.no_form_from is not None and window.free_at(now) and now < window.return_by:
        raise rules.Refused(
            f"From {rules.clock(window.no_form_from)} no request is needed. Just scan at the gate."
        )
    if now >= window.return_by:
        raise rules.Refused(
            f"{window.label} outings end at {rules.clock(window.return_by)}. Try again tomorrow."
        )
    if (
        body.requested_minutes
        and window.max_minutes
        and body.requested_minutes > window.max_minutes
    ):
        raise rules.Refused(
            f"Today you can go out for at most {rules.duration(window.max_minutes)}."
        )
    request = OutingRequest(
        student_id=student_id,
        day=window.day,
        purpose=body.purpose,
        phone=body.phone,
        emergency_name=body.emergency_name,
        emergency_relation=body.emergency_relation,
        emergency_phone=body.emergency_phone,
        requested_minutes=body.requested_minutes,
    )
    session.add(request)
    # The latest contacts the student gave are the ones worth calling.
    student.phone = body.phone
    student.emergency_name = body.emergency_name
    student.emergency_relation = body.emergency_relation
    student.emergency_phone = body.emergency_phone
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        live = await latest_today(session, student_id, window.day)
        used = (
            live is not None
            and live.status is RequestStatus.APPROVED
            and await is_used(session, live.id)
        )
        raise AlreadyRequested(used) from None
    await session.refresh(request)
    return request


async def cancel(session: AsyncSession, student_id: uuid.UUID, request_id: uuid.UUID) -> None:
    request = await session.get(OutingRequest, request_id, with_for_update=True)
    if request is None or request.student_id != student_id:
        raise NotFound
    if request.status not in (RequestStatus.PENDING, RequestStatus.APPROVED) or await is_used(
        session, request.id
    ):
        raise NotPending
    request.status = RequestStatus.CANCELLED
    await session.commit()


async def decide(
    session: AsyncSession, admin: User, request_id: uuid.UUID, *, approve: bool, note: str | None
) -> OutingRequest:
    request = await session.get(OutingRequest, request_id, with_for_update=True)
    if request is None:
        raise NotFound
    if request.status is not RequestStatus.PENDING:
        raise NotPending
    now = datetime.now(UTC)
    if request.day != rules.ist_date(now):
        raise OtherDay
    if approve:
        student = await session.get(User, request.student_id)
        assert student is not None  # requests are deleted with their student
        try:
            window = await rules.today_window(session, student, now)
        except rules.Refused:
            window = None  # no rules today: check_out refuses anyway
        if window is not None and now >= window.return_by:
            raise DayOver
    request.status = RequestStatus.APPROVED if approve else RequestStatus.DECLINED
    request.decided_by = admin.id
    request.decided_at = now
    request.note = note
    return request  # the caller audits and commits


async def queue(session: AsyncSession, day: date) -> list[tuple[OutingRequest, User]]:
    """Today's requests for admins: pending first (oldest first), then decided (newest first)."""
    rows = (
        await session.execute(
            select(OutingRequest, User)
            .join(User, User.id == OutingRequest.student_id)
            .where(OutingRequest.day == day)
        )
    ).all()
    pending = sorted(
        (r for r in rows if r[0].status is RequestStatus.PENDING), key=lambda r: r[0].created_at
    )
    rest = sorted(
        (r for r in rows if r[0].status is not RequestStatus.PENDING),
        key=lambda r: r[0].decided_at or r[0].created_at,
        reverse=True,
    )
    return [(r, u) for r, u in pending + rest]
