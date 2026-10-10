"""Late follow-up: an "are you OK?" alert, then an escalation to admins if nobody answers.

- 30 min past the return time, the student gets an alert (sent even if they muted reminders,
  and emailed if it reached no phone).
- They answer "on my way" or "I'm safe" in the app (or simply tap in). Answers are accepted
  only once they're past their return time.
- No answer 10 minutes after the alert: an escalation is opened, and admins get a push and an
  email pointing to Escalations on the website. The admin calls the student, their emergency contact
  or the hostel's warden from there.

Location: nothing new is collected. The escalation shows the last known position only if it
already exists: the student's active live share (that read is logged on the share's access
log, which the student sees), otherwise their last accepted gate scan on this outing (gate and
time).

A student who returns after their escalation opened stays listed (with `returned_at`, so the
page can say when they got back) until an admin resolves it.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import exists, insert, or_, select, update
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
# One access-log entry per admin and share in this time: reopening the page isn't a new look.
ADMIN_VIEW_GAP = timedelta(minutes=10)


class NotOut(Exception):
    pass


class NotLate(Exception):
    """A late reply before the return time has passed."""


class NotFound(Exception):
    pass


async def send_alerts(session: AsyncSession, now: datetime) -> list[tuple[uuid.UUID, datetime]]:
    """Marks outings that just became 30 min late; returns (student, due time) to alert."""
    rows = await session.execute(
        update(Outing)
        .where(
            Outing.returned_at.is_(None),
            Outing.overdue_notified_at.is_(None),
            Outing.expected_return_at < now - ALERT_AFTER,
        )
        .values(overdue_notified_at=now)
        .returning(Outing.student_id, Outing.expected_return_at)
    )
    return [(student_id, due) for student_id, due in rows.all()]


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
    """Only once past the return time: an early "on my way" must not pre-empt the alert."""
    now = datetime.now(UTC)
    outing = (
        await session.execute(
            update(Outing)
            .where(
                Outing.student_id == student_id,
                Outing.returned_at.is_(None),
                Outing.expected_return_at < now,
            )
            .values(late_reply=answer, late_replied_at=now)
            .returning(Outing)
        )
    ).scalar_one_or_none()
    if outing is None:
        out = await session.scalar(
            select(Outing.id).where(Outing.student_id == student_id, Outing.returned_at.is_(None))
        )
        raise NotOut if out is None else NotLate
    await session.commit()
    return outing


async def _log_admin_view(
    session: AsyncSession, share_id: uuid.UUID, admin: User, now: datetime
) -> None:
    """Logged on the share (the student sees it), at most once per ADMIN_VIEW_GAP per admin."""
    recent = await session.scalar(
        select(
            exists().where(
                AccessLog.session_id == share_id,
                AccessLog.admin_id == admin.id,
                AccessLog.channel == AccessChannel.ADMIN,
                AccessLog.viewed_at > now - ADMIN_VIEW_GAP,
            )
        )
    )
    if not recent:
        session.add(AccessLog(session_id=share_id, admin_id=admin.id, channel=AccessChannel.ADMIN))


async def _last_seen(
    session: AsyncSession, outing: Outing, admin: User | None
) -> LastSeenOut | None:
    """The student's live share position (logged on that share), else their last gate scan on
    this outing. A share whose only fix is a mock location shows no position, but still shows
    that the share exists (and since when the location is mocked)."""
    now = datetime.now(UTC)
    live = (
        await session.execute(
            select(ShareSession.id, Location)
            .join(Location, Location.session_id == ShareSession.id)
            .where(
                ShareSession.sharer_id == outing.student_id,
                ShareSession.status == SessionStatus.ACTIVE,
                ShareSession.ends_at > now,
            )
            # Real fixes first (latest first); a mock fix only when no share has a real one.
            .order_by(Location.mocked, Location.recorded_at.desc())
            .limit(1)
        )
    ).first()
    if live is not None:
        share_id, loc = live
        if admin is not None:
            await _log_admin_view(session, share_id, admin, now)
        if loc.mocked:
            return LastSeenOut(kind="live", at=loc.recorded_at, mock_since=loc.recorded_at)
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
            .where(
                GateScan.user_id == outing.student_id,
                GateScan.result == ScanResult.ACCEPTED,
                # This outing's scans only: an older trip's gate says nothing about tonight.
                or_(GateScan.outing_id == outing.id, GateScan.scanned_at >= outing.left_at),
            )
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
            await _last_seen(session, o, admin)
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
