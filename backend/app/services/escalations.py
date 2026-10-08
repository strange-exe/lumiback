"""Late follow-up: an "are you OK?" alert, then an escalation to admins if nobody answers.

- 30 min past the return time, the student gets an alert (sent even if they muted reminders).
- They answer "on my way" or "I'm safe" in the app (or simply tap in).
- No answer 10 minutes after the alert: an escalation is opened, and admins get a push and an
  email pointing to Admin -> Escalations. The admin calls the student, their emergency contact
  or the hostel's warden from there.

Location: nothing new is collected. The escalation shows the last known position only if it
already exists: the student's active live share (that read is logged on the share's access
log, which the student sees), otherwise their last accepted gate scan (gate and time).
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AccessChannel,
    AccessLog,
    Escalation,
    Gate,
    GateScan,
    Hostel,
    LateReply,
    Location,
    Outing,
    OutingRequest,
    ScanResult,
    SessionStatus,
    ShareSession,
    User,
    UserRole,
)
from app.schemas import EscalationOut, LastSeenOut

ALERT_AFTER = timedelta(minutes=30)  # past the return time
ESCALATE_AFTER = timedelta(minutes=10)  # after the alert, with no answer


class NotOut(Exception):
    pass


class NotFound(Exception):
    pass


async def send_alerts(session: AsyncSession, now: datetime) -> list[uuid.UUID]:
    """Marks outings that just became 30 min late; returns their students (to push)."""
    rows = await session.execute(
        update(Outing)
        .where(
            Outing.returned_at.is_(None),
            Outing.overdue_notified_at.is_(None),
            Outing.expected_return_at < now - ALERT_AFTER,
        )
        .values(overdue_notified_at=now)
        .returning(Outing.student_id)
    )
    return list(rows.scalars())


async def open_escalations(session: AsyncSession, now: datetime) -> list[uuid.UUID]:
    """Opens an escalation for each unanswered alert (once per outing); returns their ids."""
    unanswered = select(Outing.id).where(
        Outing.returned_at.is_(None),
        Outing.late_reply.is_(None),
        Outing.overdue_notified_at < now - ESCALATE_AFTER,
        ~select(Escalation.id).where(Escalation.outing_id == Outing.id).exists(),
    )
    rows = await session.execute(
        insert(Escalation).from_select(["outing_id"], unanswered).returning(Escalation.id)
    )
    return list(rows.scalars())


async def admin_ids(session: AsyncSession) -> list[tuple[uuid.UUID, str]]:
    rows = await session.execute(
        select(User.id, User.email).where(
            User.role == UserRole.ADMIN, User.email_verified_at.is_not(None)
        )
    )
    return [(i, e) for i, e in rows]


async def reply(session: AsyncSession, student_id: uuid.UUID, answer: LateReply) -> Outing:
    outing = (
        await session.execute(
            update(Outing)
            .where(Outing.student_id == student_id, Outing.returned_at.is_(None))
            .values(late_reply=answer, late_replied_at=datetime.now(UTC))
            .returning(Outing)
        )
    ).scalar_one_or_none()
    if outing is None:
        raise NotOut
    await session.commit()
    return outing


async def _last_seen(
    session: AsyncSession, student_id: uuid.UUID, admin: User | None
) -> LastSeenOut | None:
    """The student's live share position (logged on that share), else their last gate scan."""
    now = datetime.now(UTC)
    live = (
        await session.execute(
            select(ShareSession.id, Location)
            .join(Location, and_(Location.session_id == ShareSession.id, ~Location.mocked))
            .where(
                ShareSession.sharer_id == student_id,
                ShareSession.status == SessionStatus.ACTIVE,
                ShareSession.ends_at > now,
            )
            .order_by(Location.recorded_at.desc())
            .limit(1)
        )
    ).first()
    if live is not None:
        share_id, loc = live
        if admin is not None:
            session.add(
                AccessLog(session_id=share_id, admin_id=admin.id, channel=AccessChannel.ADMIN)
            )
        mocked = await session.scalar(
            select(Location.recorded_at).where(Location.session_id == share_id, Location.mocked)
        )
        return LastSeenOut(
            kind="live",
            at=loc.recorded_at,
            lat=loc.lat,
            lng=loc.lng,
            accuracy_m=loc.accuracy_m,
            mock_since=mocked if mocked and mocked > loc.recorded_at else None,
        )
    scan = (
        await session.execute(
            select(GateScan.scanned_at, Gate.name)
            .join(Gate, Gate.id == GateScan.gate_id)
            .where(GateScan.user_id == student_id, GateScan.result == ScanResult.ACCEPTED)
            .order_by(GateScan.scanned_at.desc())
            .limit(1)
        )
    ).first()
    if scan is not None:
        return LastSeenOut(kind="gate", at=scan[0], gate=scan[1])
    return None


@dataclass(frozen=True)
class _Row:
    escalation: Escalation
    outing: Outing
    student: User


async def _out(session: AsyncSession, row: _Row, admin: User | None) -> EscalationOut:
    e, o, s = row.escalation, row.outing, row.student
    hostel = await session.get(Hostel, s.hostel_id) if s.hostel_id else None
    request = await session.get(OutingRequest, o.request_id) if o.request_id else None
    resolver = await session.get(User, e.resolved_by) if e.resolved_by else None
    now = datetime.now(UTC)
    end = o.returned_at or now
    return EscalationOut(
        id=e.id,
        created_at=e.created_at,
        name=s.name,
        email=s.email,
        roll_no=s.roll_no,
        hostel=hostel.name if hostel else None,
        warden_name=hostel.warden_name if hostel else None,
        warden_phone=hostel.warden_phone if hostel else None,
        # The form's contacts were given for this outing; else the profile's.
        phone=(request.phone if request else None) or s.phone,
        emergency_name=(request.emergency_name if request else None) or s.emergency_name,
        emergency_relation=(request.emergency_relation if request else None)
        or s.emergency_relation,
        emergency_phone=(request.emergency_phone if request else None) or s.emergency_phone,
        destination=o.destination,
        purpose=o.purpose,
        left_at=o.left_at,
        expected_return_at=o.expected_return_at,
        returned_at=o.returned_at,
        late_minutes=max(0, int((end - o.expected_return_at).total_seconds() // 60)),
        alert_at=o.overdue_notified_at,
        late_reply=o.late_reply.value if o.late_reply else None,
        late_replied_at=o.late_replied_at,
        # Only while it matters: an open escalation for a student who's still out.
        last_seen=(
            await _last_seen(session, s.id, admin)
            if e.resolved_at is None and o.returned_at is None
            else None
        ),
        resolved_by=resolver.name if resolver else None,
        resolved_at=e.resolved_at,
        note=e.note,
    )


async def listing(session: AsyncSession, admin: User, *, open_only: bool) -> list[EscalationOut]:
    query = (
        select(Escalation, Outing, User)
        .join(Outing, Outing.id == Escalation.outing_id)
        .join(User, User.id == Outing.student_id)
        .order_by(Escalation.created_at.desc())
        .limit(100)
    )
    if open_only:
        query = query.where(Escalation.resolved_at.is_(None))
    rows = [_Row(*r) for r in (await session.execute(query)).all()]
    out = [await _out(session, r, admin) for r in rows]
    await session.commit()  # the access-log entries for live positions read just now
    return out


async def resolve(
    session: AsyncSession, admin: User, escalation_id: uuid.UUID, note: str | None
) -> None:
    e = await session.get(Escalation, escalation_id, with_for_update=True)
    if e is None:
        raise NotFound
    if e.resolved_at is None:
        e.resolved_at = datetime.now(UTC)
        e.resolved_by = admin.id
        e.note = note
