"""Late follow-up: an "are you OK?" alert, then an escalation to the hostel office if nobody
answers.

- 30 min past the return time, the student gets an alert (sent even if they muted reminders,
  and emailed if it reached no phone).
- They answer "on my way" or "I'm safe" in the app (or simply tap in). Answers are accepted
  only once they're past their return time.
- No answer 10 minutes after the alert: an escalation is opened, and the admins and the
  student's hostel wardens get a push (opening Escalations in the app) and an email. They call
  the student, their emergency contact or the hostel's warden from there.

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

from sqlalchemy import and_, exists, insert, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AccessChannel,
    AccessLog,
    CallOutcome,
    Escalation,
    EscalationCall,
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
    WardenHostel,
)
from app.schemas import EscalationCallOut, EscalationOut, LastSeenOut
from app.services.admin import student_name, student_roll_no
from app.services.staff import (
    EVERY_HOSTEL,
    Staff,
    claim_is_live,
    head_office,
    office_for,
    staff_of,
)

ALERT_AFTER = timedelta(minutes=30)  # past the return time
ESCALATE_AFTER = timedelta(minutes=10)  # after the alert, with no answer
# An answer ("on my way", "I'm safe") holds the escalation off for this long. A student who
# answered and still isn't back after it is escalated all the same: one reply mustn't silence the
# hostel office for the whole night.
REPLY_COVERS = timedelta(minutes=60)
# One access-log entry per admin and share in this time: reopening the page isn't a new look.
ADMIN_VIEW_GAP = timedelta(minutes=10)
# Re-alerts of an unclaimed escalation stop after this many (the hand-over to the head wardens
# is never skipped): two hours of nudges at the default 15 min. One still open after that stays
# on the Escalations page and the office's badge, but stops waking phones: a student "late"
# that long has nearly always just not tapped in, and an alarm every 15 min all night would
# teach the office to ignore the urgent channel.
MAX_REALERTS = 8


class NotOut(Exception):
    pass


class NotLate(Exception):
    """A late reply before the return time has passed."""


class NotFound(Exception):
    pass


@dataclass(frozen=True)
class Late:
    outing_id: uuid.UUID
    student_id: uuid.UUID
    due: datetime


async def send_alerts(session: AsyncSession, now: datetime) -> list[Late]:
    """Marks outings that just became 30 min late; returns each one to alert."""
    rows = await session.execute(
        update(Outing)
        .where(
            Outing.returned_at.is_(None),
            Outing.overdue_notified_at.is_(None),
            Outing.expected_return_at < now - ALERT_AFTER,
        )
        .values(overdue_notified_at=now)
        .returning(Outing.id, Outing.student_id, Outing.expected_return_at)
    )
    return [Late(o, s, due) for o, s, due in rows.all() if s is not None]


async def open_escalations(
    session: AsyncSession, now: datetime
) -> list[tuple[uuid.UUID, uuid.UUID | None]]:
    """Opens an escalation (once per outing) for each alert left unanswered, and for each
    student who answered but still isn't back an hour later; returns each one opened with the
    student's hostel (None: no hostel chosen)."""
    unanswered = and_(
        Outing.late_reply.is_(None), Outing.overdue_notified_at < now - ESCALATE_AFTER
    )
    answered_but_still_out = and_(
        Outing.late_reply.is_not(None), Outing.late_replied_at < now - REPLY_COVERS
    )
    due = select(Outing.id).where(
        Outing.returned_at.is_(None),
        Outing.overdue_notified_at.is_not(None),
        or_(unanswered, answered_but_still_out),
        ~select(Escalation.id).where(Escalation.outing_id == Outing.id).exists(),
    )
    rows = await session.execute(
        insert(Escalation)
        .from_select(["outing_id"], due)
        .returning(Escalation.id, Escalation.outing_id)
    )
    opened = dict((outing_id, e_id) for e_id, outing_id in rows.all())
    if not opened:
        return []
    # The hostel the student was in when they went out: its wardens are the ones to tell.
    hostels = await session.execute(
        select(Outing.id, Outing.hostel_id).where(Outing.id.in_(list(opened)))
    )
    return [(opened[outing_id], hostel_id) for outing_id, hostel_id in hostels.all()]


@dataclass(frozen=True)
class Recipient:
    user_id: uuid.UUID
    email: str
    count: int  # escalations just opened that this person looks after


async def recipients(session: AsyncSession, hostels: list[uuid.UUID | None]) -> list[Recipient]:
    """Every admin and head warden (all of them), plus the wardens of each escalated student's
    hostel (theirs)."""
    if not hostels:
        return []
    rows = (
        await session.execute(
            select(User.id, User.email, User.role, WardenHostel.hostel_id)
            .outerjoin(WardenHostel, WardenHostel.user_id == User.id)
            .where(
                User.email_verified_at.is_not(None),
                User.deactivated_at.is_(None),
                or_(
                    User.role.in_(EVERY_HOSTEL),
                    and_(User.role == UserRole.WARDEN, WardenHostel.hostel_id.in_(hostels)),
                ),
            )
        )
    ).all()
    counts: dict[tuple[uuid.UUID, str], int] = {}
    for user_id, email, role, hostel_id in rows:
        key = (user_id, email)
        if role in EVERY_HOSTEL:
            counts[key] = len(hostels)
        else:  # one row per assigned hostel
            counts[key] = counts.get(key, 0) + hostels.count(hostel_id)
    return [Recipient(u, e, n) for (u, e), n in counts.items() if n]


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
    session: AsyncSession, outing: Outing, admin: User | None, *, live_ok: bool = True
) -> LastSeenOut | None:
    """The student's live share position (logged on that share), else their last gate scan on
    this outing. A share whose only fix is a mock location shows no position, but still shows
    that the share exists (and since when the location is mocked). `live_ok` False (a developer
    viewing as an admin): the gate scan only, so no live position is read or logged."""
    now = datetime.now(UTC)
    live = (
        (
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
        if live_ok
        else None
    )
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
    student: User | None  # None: the student deleted their account (only a handled one stays)


async def _out(
    session: AsyncSession, row: _Row, admin: User | None, *, live_ok: bool = True
) -> EscalationOut:
    e, o, s = row.escalation, row.outing, row.student
    # The hostel (and warden) responsible for this outing: the one the student was in then.
    hostel = await session.get(Hostel, o.hostel_id) if o.hostel_id else None
    request = await session.get(OutingRequest, o.request_id) if o.request_id else None
    resolver = await session.get(User, e.resolved_by) if e.resolved_by else None
    claimer = await session.get(User, e.claimed_by) if e.claimed_by else None
    now = datetime.now(UTC)
    end = o.returned_at or now
    return EscalationOut(
        id=e.id,
        created_at=e.created_at,
        name=student_name(o, s),
        email=s.email if s else None,
        roll_no=student_roll_no(o, s),
        hostel=hostel.name if hostel else None,
        warden_name=hostel.warden_name if hostel else None,
        warden_phone=hostel.warden_phone if hostel else None,
        # The form's contacts were given for this outing; else the profile's.
        phone=(request.phone if request else None) or (s.phone if s else None),
        emergency_name=(request.emergency_name if request else None)
        or (s.emergency_name if s else None),
        emergency_relation=(request.emergency_relation if request else None)
        or (s.emergency_relation if s else None),
        emergency_phone=(request.emergency_phone if request else None)
        or (s.emergency_phone if s else None),
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
            await _last_seen(session, o, admin, live_ok=live_ok)
            if e.resolved_at is None and o.returned_at is None
            else None
        ),
        resolved_by=resolver.name if resolver else None,
        resolved_at=e.resolved_at,
        note=e.note,
        claimed_by=claimer.name if claimer else None,
        claimed_by_me=admin is not None and e.claimed_by == admin.id,
        claimed_at=e.claimed_at,
        handed_over_at=e.handed_over_at,
        realerts=e.realerts,
        calls=[
            EscalationCallOut(at=c.at, by=name, outcome=c.outcome.value, note=c.note)
            for c, name in await session.execute(
                select(EscalationCall, User.name)
                .outerjoin(User, User.id == EscalationCall.by_id)
                .where(EscalationCall.escalation_id == e.id)
                .order_by(EscalationCall.at)
            )
        ],
    )


async def listing(
    session: AsyncSession, staff: Staff, *, open_only: bool, live_ok: bool = True
) -> list[EscalationOut]:
    """Newest first; a warden sees their hostels' students only. `live_ok` False: no live
    positions (a developer viewing as this office; see _last_seen)."""
    query = (
        select(Escalation, Outing, User)
        .join(Outing, Outing.id == Escalation.outing_id)
        .outerjoin(User, User.id == Outing.student_id)  # a deleted account's record too
        .where(staff.covers(Outing.hostel_id))
        .order_by(Escalation.created_at.desc())
        .limit(100)
    )
    if open_only:
        query = query.where(Escalation.resolved_at.is_(None))
    rows = [_Row(*r) for r in (await session.execute(query)).all()]
    out = [await _out(session, r, staff.user, live_ok=live_ok) for r in rows]
    await session.commit()  # the access-log entries for live positions read just now
    return out


async def _covered(session: AsyncSession, staff: Staff, escalation_id: uuid.UUID) -> Escalation:
    """The escalation, locked, if this staff member looks after its outing's hostel."""
    e = await session.get(Escalation, escalation_id, with_for_update=True)
    if e is None:
        raise NotFound
    outing = await session.get(Outing, e.outing_id)
    if outing is None or not staff.covers_hostel(outing.hostel_id):
        raise NotFound  # another hostel's outing: as if it didn't exist
    return e


async def resolve(
    session: AsyncSession, staff: Staff, escalation_id: uuid.UUID, note: str | None
) -> None:
    e = await _covered(session, staff, escalation_id)
    if e.resolved_at is None:
        e.resolved_at = datetime.now(UTC)
        e.resolved_by = staff.user.id
        e.note = note


# ---------- follow-up: claim, call log, re-alerts, hand-over ----------


class Resolved(Exception):
    """Already handled: nothing more to claim or log."""


class ClaimedByOther(Exception):
    def __init__(self, name: str) -> None:
        super().__init__(name)
        self.name = name


async def _claimer_name(session: AsyncSession, e: Escalation) -> str:
    user = await session.get(User, e.claimed_by) if e.claimed_by else None
    return user.name if user else "someone else"


async def _held(session: AsyncSession, e: Escalation) -> bool:
    """Whether someone holds a live claim on it: claimed by someone who can still act on it
    (account on, still looking after the outing's hostel). A lapsed claim counts as none."""
    if e.claimed_by is None:
        return False
    claimer = await session.get(User, e.claimed_by)
    if claimer is None or claimer.deactivated_at is not None:
        return False
    office = await staff_of(session, claimer)
    outing = await session.get(Outing, e.outing_id)
    return office is not None and outing is not None and office.covers_hostel(outing.hostel_id)


async def claim(session: AsyncSession, staff: Staff, escalation_id: uuid.UUID) -> bool:
    """ "I'm on it": stops the re-alerts. Returns False if this person had it already (the
    caller then audits nothing). Someone else's claim stays theirs while it's live (see
    _held); a lapsed one is taken over."""
    e = await _covered(session, staff, escalation_id)
    if e.resolved_at is not None:
        raise Resolved
    if e.claimed_by == staff.user.id:
        return False
    if await _held(session, e):
        raise ClaimedByOther(await _claimer_name(session, e))
    e.claimed_by = staff.user.id
    e.claimed_at = datetime.now(UTC)
    return True


async def release(session: AsyncSession, staff: Staff, escalation_id: uuid.UUID) -> None:
    """Gives a claim back (re-alerts start again from now). Only the person who claimed it,
    or a head warden or admin, may; anyone covering the hostel may give back a lapsed one."""
    e = await _covered(session, staff, escalation_id)
    if e.resolved_at is not None:
        raise Resolved
    if e.claimed_by is None:
        return
    if e.claimed_by != staff.user.id and not staff.every_hostel and await _held(session, e):
        raise ClaimedByOther(await _claimer_name(session, e))
    e.claimed_by = None
    e.claimed_at = None
    e.realerted_at = datetime.now(UTC)  # the next re-alert is a full interval away


async def log_call(
    session: AsyncSession,
    staff: Staff,
    escalation_id: uuid.UUID,
    outcome: CallOutcome,
    note: str | None,
) -> EscalationCall:
    """Someone logging a call is following up: an unclaimed escalation (or one whose claim
    lapsed) becomes theirs."""
    e = await _covered(session, staff, escalation_id)
    if e.resolved_at is not None:
        raise Resolved
    if not await _held(session, e):
        e.claimed_by = staff.user.id
        e.claimed_at = datetime.now(UTC)
    call = EscalationCall(escalation_id=e.id, by_id=staff.user.id, outcome=outcome, note=note)
    session.add(call)
    return call


@dataclass(frozen=True)
class FollowUp:
    escalation_id: uuid.UUID
    realerts: int  # this escalation's re-alert number (0 for the hand-over)
    handed_over: bool  # True: the hand-over to the head wardens
    recipients: list[User]


async def follow_ups(
    session: AsyncSession, now: datetime, realert_every: timedelta, hand_over_after: timedelta
) -> list[FollowUp]:
    """For open escalations nobody has claimed while the student is still out: hands each one
    to the head wardens once `hand_over_after` has passed since it opened, and otherwise
    re-alerts every `realert_every`, at most MAX_REALERTS times. Before the hand-over,
    re-alerts go to the student's hostel's office first (its wardens; the head wardens or
    admins if it has none); after it, to the head wardens (the admins if there are none). A
    claim whose claimer can no longer act on it (turned off, or no longer looking after the
    hostel) has lapsed: it's dropped and the follow-up goes on. Rows are locked (SKIP LOCKED),
    so two sweeps at once can't both send one."""
    rows = (
        await session.execute(
            select(Escalation, Outing.hostel_id)
            .join(Outing, Outing.id == Escalation.outing_id)
            .where(
                Escalation.resolved_at.is_(None),
                or_(Escalation.claimed_by.is_(None), ~claim_is_live(Outing.hostel_id)),
                or_(Escalation.handed_over_at.is_(None), Escalation.realerts < MAX_REALERTS),
                Outing.returned_at.is_(None),
            )
            .with_for_update(of=Escalation, skip_locked=True)
        )
    ).all()
    if not rows:
        return []
    head = await head_office(session)
    out: list[FollowUp] = []
    for e, hostel_id in rows:
        if e.claimed_by is not None:  # lapsed
            e.claimed_by = None
            e.claimed_at = None
        if e.handed_over_at is None and e.created_at <= now - hand_over_after:
            e.handed_over_at = now
            e.realerted_at = now
            out.append(FollowUp(e.id, 0, True, head))
        elif e.realerts < MAX_REALERTS and (e.realerted_at or e.created_at) <= now - realert_every:
            e.realerted_at = now
            e.realerts += 1
            who = head if e.handed_over_at else await office_for(session, hostel_id)
            out.append(FollowUp(e.id, e.realerts, False, who))
    return out
