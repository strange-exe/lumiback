"""What each alert says and who gets it. Everything here only queues rows in the caller's
transaction (services/outbox.py sends them once it commits).

Sweep alerts (jobs/expiry.py): the late "are you OK?" alert, the escalation alert, the
follow-ups of escalations nobody has claimed (re-alerts, then the hand-over to the head
wardens), and reminders for outing requests left waiting (the hostel's wardens, then the head
wardens as backup approvers).

Alerts a person causes: a student who is out asks the office to call them, says they're
running late, or presses Help, and the office sends a notice to its students who are out.
Followers' notices are in services/followers.py.

Pushes to the hostel office name the student (they open the app behind its sign-in); emails
to the office never do (names and numbers stay behind the sign-in, as in the escalation
email). Timings come from Admin > Settings (campus_settings).
"""

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.email import Email
from app.email_templates import (
    Fix,
    call_me_email,
    escalation_email,
    escalation_follow_up_email,
    help_contact_email,
    help_office_email,
    late_alert_email,
    office_notice_email,
    request_waiting_email,
    running_late_office_email,
)
from app.models import (
    CampusSettings,
    HelpRequest,
    Hostel,
    OutboxMode,
    Outing,
    OutingRequest,
    RequestStatus,
    User,
)
from app.push import PushMessage
from app.schemas import OfficeContact
from app.security.rate_limit import Limit, RateLimited, RateLimiter
from app.services import escalations, outbox
from app.services import followers as follower_alerts
from app.services.followers import followers
from app.services.rules import IST, ist_date
from app.services.safe_return import canonical_address
from app.services.staff import Staff, head_office, hostel_wardens, office_for

MINUTE = timedelta(minutes=1)
URGENT = "return-reminders"  # the Android channel safety messages use
REQUESTS = "share-status"  # the app's "Sharing and requests" switch


@dataclass(frozen=True)
class Timings:
    request_remind: timedelta = timedelta(minutes=15)
    request_backup: timedelta = timedelta(minutes=30)
    escalation_realert: timedelta = timedelta(minutes=15)
    escalation_takeover: timedelta = timedelta(minutes=30)


async def timings(session: AsyncSession) -> Timings:
    row = await session.get(CampusSettings, 1)
    if row is None:
        return Timings()
    return Timings(
        timedelta(minutes=row.request_remind_minutes),
        timedelta(minutes=row.request_backup_minutes),
        timedelta(minutes=row.escalation_realert_minutes),
        timedelta(minutes=row.escalation_takeover_minutes),
    )


def _hhmm(moment: datetime) -> str:
    t = moment.astimezone(IST)
    return f"{t.hour % 12 or 12}:{t.minute:02d} {'AM' if t.hour < 12 else 'PM'}"


async def _staff_alert(
    session: AsyncSession,
    key: str,
    kind: str,
    people: list[User],
    push: PushMessage,
    email: Callable[[str], Email],  # the office member's address -> their email
    *,
    follows: uuid.UUID | None = None,
) -> list[int]:
    """Push to each office member, email those with no app (or, if urgent, no phone that took
    it). Sent only while they're still staff; with `follows` (a student's id), to people who
    follow that student instead, sent only while they still do."""
    ids = []
    for person in people:
        found = await outbox.enqueue(
            session,
            key=f"{key}:{person.id}",
            kind=kind,
            mode=OutboxMode.PUSH_OR_EMAIL,
            user_id=person.id,
            push=push,
            email=email(person.email),
            staff_only=follows is None,
            follows=follows,
        )
        if found is not None:
            ids.append(found)
    return ids


# ---------- the sweep ----------


async def late_alerts(session: AsyncSession, now: datetime, web_url: str) -> int:
    """30 min past the return time: "are you OK?" to each student (emailed if they don't use
    the app, or if it reached no phone). Returns how many."""
    late = await escalations.send_alerts(session, now)
    if not late:
        return 0
    users = {
        u.id: u
        for u in await session.scalars(
            select(User).where(User.id.in_([x.student_id for x in late]))
        )
    }
    trips = {
        o.id: o
        for o in await session.scalars(
            select(Outing).where(Outing.id.in_([x.outing_id for x in late]))
        )
    }
    for x in late:
        student = users.get(x.student_id)
        if student is None:
            continue
        if (trip := trips.get(x.outing_id)) is not None:  # the people they share with, too
            await follower_alerts.late(session, student, trip, now, web_url)
        # The real lateness, in case the sweep ran late (e.g. right after a restart).
        minutes = max(
            int(escalations.ALERT_AFTER.total_seconds() // 60), int((now - x.due) // MINUTE)
        )
        await outbox.enqueue(
            session,
            key=f"late:{x.outing_id}",
            kind="late_alert",
            mode=OutboxMode.PUSH_OR_EMAIL,
            user_id=student.id,
            push=PushMessage(
                title=f"You're {minutes} min late. Are you OK?",
                body="Tap to answer. If there's no answer in 10 minutes, the hostel office "
                "is told.",
                url="/today",
                channel=URGENT,
                urgent=True,
            ),
            email=late_alert_email(
                to=student.email, name=student.name, due_at=x.due, web_url=web_url
            ),
        )
    return len(late)


async def escalation_opened(
    session: AsyncSession, opened: list[tuple[uuid.UUID, uuid.UUID | None]], web_url: str
) -> None:
    """Every admin and head warden, and the hostel's wardens: a push and an email each."""
    if not opened:
        return
    batch = min(str(e_id) for e_id, _ in opened)  # stable for these escalations
    for person in await escalations.recipients(session, [h for _, h in opened]):
        await outbox.enqueue(
            session,
            key=f"escalation:{batch}:{person.user_id}:push",
            kind="escalation",
            mode=OutboxMode.PUSH,
            user_id=person.user_id,
            push=PushMessage(
                title="A late student needs follow-up",
                body="Open Escalations in Lumiback to follow up.",
                url="/office/escalations",
                channel=URGENT,
                urgent=True,
            ),
            staff_only=True,
        )
        await outbox.enqueue(
            session,
            key=f"escalation:{batch}:{person.user_id}:email",
            kind="escalation",
            mode=OutboxMode.EMAIL,
            user_id=person.user_id,  # checked again at send time, and sent to their address then
            email=escalation_email(to=person.email, count=person.count, web_url=web_url),
            staff_only=True,
        )


async def escalation_follow_ups(
    session: AsyncSession, now: datetime, t: Timings, web_url: str
) -> int:
    """Re-alerts and hand-overs for escalations nobody has claimed (escalations.follow_ups).
    Returns how many escalations were followed up."""
    due = await escalations.follow_ups(session, now, t.escalation_realert, t.escalation_takeover)
    takeover = int(t.escalation_takeover // MINUTE)
    for f in due:
        if f.handed_over:
            key = f"escalation-handover:{f.escalation_id}"
            title = "A late student needs you to take over"
            body = f"Nobody has claimed it in {takeover} min."
        else:
            key = f"escalation-realert:{f.escalation_id}:{f.realerts}"
            title = "A late student still needs follow-up"
            body = "Nobody has claimed it yet."
        push = PushMessage(
            title=title,
            body=f"{body} Open Escalations and choose I'm on it.",
            url="/office/escalations",
            channel=URGENT,
            urgent=True,
        )
        await _staff_alert(
            session,
            key,
            "escalation_follow_up",
            f.recipients,
            push,
            lambda to, handed_over=f.handed_over: escalation_follow_up_email(
                to=to, handed_over=handed_over, web_url=web_url
            ),
        )
    return len(due)


async def request_reminders(session: AsyncSession, now: datetime, t: Timings, web_url: str) -> int:
    """Today's requests still pending: after `request_remind`, the deciders (the hostel's
    wardens, or the head wardens or admins if it has none) are reminded once; after
    `request_backup`, the head wardens (the admins if there are none) are told once that they
    may decide it, unless they were the deciders already. Head wardens could always decide
    any hostel's request; this tells them when one is waiting. Returns how many requests."""
    rows = (
        await session.execute(
            select(OutingRequest, User)
            .join(User, User.id == OutingRequest.student_id)
            .where(
                OutingRequest.status == RequestStatus.PENDING,
                OutingRequest.day == ist_date(now),
                or_(
                    and_(
                        OutingRequest.reminded_at.is_(None),
                        OutingRequest.created_at <= now - t.request_remind,
                    ),
                    and_(
                        OutingRequest.backup_notified_at.is_(None),
                        OutingRequest.created_at <= now - t.request_backup,
                    ),
                ),
            )
            .with_for_update(of=OutingRequest, skip_locked=True)
        )
    ).all()
    for r, student in rows:
        deciders = await office_for(session, student.hostel_id)
        waited = int((now - r.created_at) // MINUTE)
        if r.reminded_at is None and r.created_at <= now - t.request_remind:
            r.reminded_at = now
            await _staff_alert(
                session,
                f"request-remind:{r.id}",
                "request_reminder",
                deciders,
                PushMessage(
                    title="An outing request is waiting",
                    body=f"{student.name} has waited {waited} min for a decision.",
                    url="/office/requests",
                    channel=REQUESTS,
                ),
                lambda to, waited=waited: request_waiting_email(
                    to=to, backup=False, minutes=waited, web_url=web_url
                ),
            )
        if r.backup_notified_at is None and r.created_at <= now - t.request_backup:
            r.backup_notified_at = now
            told = {u.id for u in deciders}
            backups = [u for u in await head_office(session) if u.id not in told]
            await _staff_alert(
                session,
                f"request-backup:{r.id}",
                "request_backup",
                backups,
                PushMessage(
                    title="An outing request needs a backup decision",
                    body=f"{student.name} has waited {waited} min. You can approve or decline it.",
                    url="/office/requests",
                    channel=REQUESTS,
                ),
                lambda to, waited=waited: request_waiting_email(
                    to=to, backup=True, minutes=waited, web_url=web_url
                ),
            )
    return len(rows)


# ---------- alerts a person causes ----------


async def office_contact(session: AsyncSession, outing: Outing) -> OfficeContact | None:
    """The office of the outing's hostel; None if the student had no hostel then."""
    hostel = await session.get(Hostel, outing.hostel_id) if outing.hostel_id else None
    if hostel is None:
        return None
    return OfficeContact(hostel=hostel.name, name=hostel.warden_name, phone=hostel.warden_phone)


async def call_me(session: AsyncSession, student: User, outing: Outing, web_url: str) -> list[int]:
    """A student who is out asks the office to call them: their outing's hostel's wardens (or
    the head wardens or admins if it has none). Urgent: it reaches muted phones too."""
    people = await office_for(session, outing.hostel_id)
    return await _staff_alert(
        session,
        f"call-me:{uuid.uuid4()}",
        "call_me",
        people,
        PushMessage(
            title=f"{student.name} asks the office to call",
            body="They're out and asked for a call. Their number is on their record.",
            url=f"/office/student/{student.id}",
            channel=URGENT,
            urgent=True,
        ),
        lambda to: call_me_email(to=to, student_id=str(student.id), web_url=web_url),
    )


async def notice(
    session: AsyncSession,
    staff: Staff,
    hostel_id: uuid.UUID | None,
    message: str,
    recall: bool,
    web_url: str,
) -> tuple[int, list[int]]:
    """The office's notice to students who are out now, in the sender's hostels (the
    outing's hostel, as on the register), or in one of them. Students without the app are
    emailed. Returns (students, outbox ids)."""
    query = (
        select(User)
        .join(Outing, Outing.student_id == User.id)
        .where(
            Outing.returned_at.is_(None),
            staff.covers(Outing.hostel_id),
            User.deactivated_at.is_(None),
        )
    )
    if hostel_id is not None:
        query = query.where(Outing.hostel_id == hostel_id)
    students = list(await session.scalars(query))
    batch = uuid.uuid4()
    title = "Come back to the hostel now" if recall else "Notice from the hostel office"
    ids = []
    for s in students:
        found = await outbox.enqueue(
            session,
            key=f"notice:{batch}:{s.id}",
            kind="recall" if recall else "notice",
            mode=OutboxMode.PUSH_OR_EMAIL,
            user_id=s.id,
            push=PushMessage(
                title=title, body=message, url="/today", channel=URGENT, urgent=recall
            ),
            email=office_notice_email(
                to=s.email, name=s.name, message=message, recall=recall, web_url=web_url
            ),
        )
        if found is not None:
            ids.append(found)
    return len(students), ids


async def running_late(
    session: AsyncSession, student: User, outing: Outing, web_url: str
) -> list[int]:
    """The student said they're running late (services/running_late.py): the hostel's wardens
    (the head wardens or admins if it has none). Not urgent: the student is fine and said so.
    The push names them and gives the reason; the email, as every office email, does not."""
    assert outing.original_return_at is not None and outing.running_late_minutes is not None
    new, was = _hhmm(outing.expected_return_at), _hhmm(outing.original_return_at)
    reason = f' Reason: "{outing.running_late_reason}"' if outing.running_late_reason else ""
    return await _staff_alert(
        session,
        f"running-late:{outing.id}",
        "running_late",
        await office_for(session, outing.hostel_id),
        PushMessage(
            title=f"{student.name} is running late",
            body=f"Now due back at {new} (was {was}).{reason}",
            url=f"/office/student/{student.id}",
            channel=REQUESTS,
        ),
        lambda to: running_late_office_email(
            to=to,
            minutes=outing.running_late_minutes or 0,
            due_at=outing.expected_return_at,
            was=outing.original_return_at or outing.expected_return_at,
            web_url=web_url,
        ),
    )


# Help mail goes to an address the student typed, as safe-return mail does, and a student
# could otherwise use it to mail anyone: like safe return's limits (5 a day per student and per
# inbox), at most HELP_CONTACT_PER_ADDRESS a day to one inbox (canonical form, so plus-tags and
# case share it) and HELP_CONTACT_PER_STUDENT a day from one student (an emergency contact and
# a safe-return contact, five presses each). The office and followers are told every time.
HELP_CONTACT_PER_ADDRESS = Limit(max_hits=5, window_seconds=24 * 3600)
HELP_CONTACT_PER_STUDENT = Limit(max_hits=10, window_seconds=24 * 3600)


async def help_contact_allowed(limiter: RateLimiter, student_id: uuid.UUID, address: str) -> bool:
    """Counts one Help email to `address` against both limits, atomically; False (neither
    counted) if either is full."""
    try:
        await limiter.hit_all(
            [
                ("help:contact_student", str(student_id), HELP_CONTACT_PER_STUDENT),
                ("help:contact", canonical_address(address), HELP_CONTACT_PER_ADDRESS),
            ]
        )
    except RateLimited:
        return False
    return True


@dataclass(frozen=True)
class HelpSent:
    request: HelpRequest
    ids: list[int]
    office: OfficeContact | None
    office_told: int
    followers_told: int
    contact_told: bool


async def help_alert(
    session: AsyncSession,
    student: User,
    outing: Outing,
    fix: Fix | None,
    now: datetime,
    web_url: str,
    contact_ok: Callable[[str], Awaitable[bool]] | None = None,
) -> HelpSent:
    """A student who is out pressed Help. Saved (with the one fix) and, all urgent: the
    outing's hostel's wardens and the head wardens (the admins if neither exists) by push,
    and by email with the fix but no name; the people the student shares their location with
    by push (email if they don't use the app); their emergency contact (and the safe-return
    contact, if different) by email, each only if `contact_ok` allows that address (see
    help_contact_allowed). Nobody but the office gets the location."""
    request = HelpRequest(
        student_id=student.id,
        outing_id=outing.id,
        hostel_id=outing.hostel_id,
        lat=fix.lat if fix else None,
        lng=fix.lng if fix else None,
        accuracy_m=fix.accuracy_m if fix else None,
        mocked=fix.mocked if fix else False,
    )
    session.add(request)
    await session.flush()
    key = f"help:{request.id}"
    at = _hhmm(now)
    office = await office_contact(session, outing)

    people: dict[uuid.UUID, User] = {}
    for u in await hostel_wardens(session, outing.hostel_id) + await head_office(session):
        people[u.id] = u
    ids = await _staff_alert(
        session,
        f"{key}:office",
        "help_office",
        list(people.values()),
        PushMessage(
            title=f"Help: {student.name} pressed Help",
            body=f"At {at}. Open Escalations for where they were and their number.",
            url="/office/escalations",
            channel=URGENT,
            urgent=True,
        ),
        lambda to: help_office_email(to=to, at=now, fix=fix, web_url=web_url),
    )

    near = [u for u in await followers(session, student, now) if u.id not in people]
    ids += await _staff_alert(
        session,
        f"{key}:follower",
        "help_follower",
        near,
        PushMessage(
            title=f"{student.name} pressed Help",
            body=f"They asked the hostel office for help at {at}. Call them if you can.",
            url="/live?view=follow",  # what they follow, in the app
            channel=URGENT,
            urgent=True,
        ),
        lambda to: help_contact_email(
            to=to,
            contact_name=None,
            student=student.name,
            at=now,
            phone=student.phone,
            office_phone=office.phone if office else None,
            follower=True,
        ),
        follows=student.id,
    )

    told = {u.email for u in near}
    addresses = [a for a in (student.emergency_email, outing.safe_return_email) if a]
    contact_told = False
    for i, address in enumerate(dict.fromkeys(a.lower() for a in addresses)):
        if address in told or address == student.email:
            continue
        if contact_ok is not None and not await contact_ok(address):
            continue  # this inbox (or this student) had its Help mail for today
        found = await outbox.enqueue(
            session,
            key=f"{key}:contact:{i}",  # no address in the key: it outlives the payload
            kind="help_contact",
            mode=OutboxMode.EMAIL,
            email=help_contact_email(
                to=address,
                contact_name=student.emergency_name,
                student=student.name,
                at=now,
                phone=student.phone,
                office_phone=office.phone if office else None,
                follower=False,
            ),
        )
        if found is not None:
            ids.append(found)
            contact_told = True
    return HelpSent(request, ids, office, len(people), len(near), contact_told)
