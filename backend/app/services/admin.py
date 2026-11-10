"""Admin reads and changes: who is out, gate scans, gates, campus settings, roles.

Register reads take a Staff: admins see every student, wardens only their hostels' students.
Staff see the register (who left, when, through which gate, whether verified), not live
locations or share data. The one exception is an open late escalation, which shows the
student's last known position (app/services/escalations.py; each read is logged on the share).
Changes are written to admin_audit.
"""

import csv
import io
import uuid
from collections.abc import Sequence
from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import delete, func, or_, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models import (
    AdminAudit,
    Escalation,
    Gate,
    GateScan,
    HelpRequest,
    Hostel,
    InVia,
    Outing,
    OutingCorrection,
    OutingRequest,
    RequestStatus,
    ScanResult,
    User,
    UserRole,
    Via,
    WardenHostel,
)
from app.schemas import (
    AdminOuting,
    AdminOverview,
    AdminScan,
    AdminScanPage,
    AdminUser,
    AuditEntry,
    AuditPage,
    StudentOut,
)
from app.services.account_links import has_password
from app.services.outings import rules_in_use, status_of
from app.services.rules import ist_date
from app.services.staff import Staff, clear_lapsed_claims, warden_hostel_ids

IST = timedelta(hours=5, minutes=30)
MAX_EXPORT_DAYS = 92
# How far back the office can correct an outing (app/services/corrections.py).
CORRECTABLE_FOR = timedelta(days=30)


class LastAdmin(Exception):
    """Refused: the campus would be left without an admin."""


# The developer role comes from scripts/make_developer.py; the dashboard never changes a
# developer's role, email or on/off state, and never deletes one.
DEVELOPER_LOCKED = "A developer's account is changed on the server, not here"


class DeveloperLocked(Exception):
    """Refused: the target is a developer (see DEVELOPER_LOCKED)."""


def ist_midnight(now: datetime) -> datetime:
    local = now.astimezone(UTC) + IST
    return (datetime.combine(local.date(), time()) - IST).replace(tzinfo=UTC)


def audit(session: AsyncSession, actor: User, action: str, target: str) -> None:
    session.add(AdminAudit(actor_id=actor.id, action=action, target=target[:160]))


# The first word of every admin_audit action ("gate:create" -> "gate"): what the audit log
# viewer filters by. A new kind of action gets its area added here (and a label on the web).
AUDIT_AREAS = (
    "account",
    "announce",
    "correction",
    "escalation",
    "gate",
    "help",
    "holiday",
    "hostel",
    "invite",
    "notice",
    "outing",
    "password",
    "people",
    "request",
    "role",
    "rules",
    "settings",
    "student",
)


async def audit_log(
    session: AsyncSession,
    *,
    before: int | None,
    limit: int,
    area: str | None = None,
    q: str | None = None,
    days: tuple[date, date] | None = None,
) -> AuditPage:
    """admin_audit, newest first, `limit` at a time. `area`: one kind of change (AUDIT_AREAS).
    `q`: who made it (name or email) or what it was about. `days`: IST dates, inclusive."""
    query = (
        select(AdminAudit, User)
        .outerjoin(User, User.id == AdminAudit.actor_id)  # a deleted account's changes too
        .order_by(AdminAudit.id.desc())
        .limit(limit + 1)
    )
    if before is not None:
        query = query.where(AdminAudit.id < before)
    if area is not None:
        query = query.where(
            or_(AdminAudit.action == area, AdminAudit.action.like(f"{area}:%", escape="\\"))
        )
    if q:
        pattern = _like(q)
        query = query.where(
            or_(
                func.lower(func.coalesce(User.name, "")).like(pattern, escape="\\"),
                func.lower(func.coalesce(User.email, "")).like(pattern, escape="\\"),
                func.lower(AdminAudit.target).like(pattern, escape="\\"),
            )
        )
    if days is not None:
        since, until = ist_days(*days)
        query = query.where(AdminAudit.at >= since, AdminAudit.at < until)
    rows = list(await session.execute(query))
    page = rows[:limit]
    return AuditPage(
        items=[
            AuditEntry(
                id=a.id,
                at=a.at,
                actor_name=u.name if u is not None else None,
                actor_email=u.email if u is not None else None,
                actor_role=u.role.value if u is not None else None,
                action=a.action,
                target=a.target,
            )
            for a, u in page
        ],
        next_before=page[-1][0].id if len(rows) > limit else None,
    )


def student_name(o: Outing, u: User | None) -> str:
    """Who an outing belongs to, for the office: the account's name, or the name kept when the
    student deleted their account (queries outer-join User for those rows)."""
    return u.name if u is not None else f"{o.student_name} (deleted account)"


def student_roll_no(o: Outing, u: User | None) -> str | None:
    return u.roll_no if u is not None else o.student_roll_no


async def overview(session: AsyncSession, staff: Staff) -> AdminOverview:
    now = datetime.now(UTC)
    since = ist_midnight(now)
    mine = staff.covers(User.hostel_id)
    # Outings count for the hostel the student was in when they went out.
    mine_out = staff.covers(Outing.hostel_id)
    open_ = Outing.returned_at.is_(None)
    outings = select(func.count()).select_from(Outing)
    out_now = await session.scalar(outings.where(mine_out, open_, Outing.expected_return_at >= now))
    overdue = await session.scalar(outings.where(mine_out, open_, Outing.expected_return_at < now))
    scans = select(func.count()).select_from(GateScan).join(User, User.id == GateScan.user_id)
    accepted = await session.scalar(
        scans.where(mine, GateScan.scanned_at >= since, GateScan.result == ScanResult.ACCEPTED)
    )
    rejected = await session.scalar(
        scans.where(mine, GateScan.scanned_at >= since, GateScan.result != ScanResult.ACCEPTED)
    )
    gates = await session.scalar(select(func.count()).select_from(Gate).where(Gate.active))
    pending = await session.scalar(
        select(func.count())
        .select_from(OutingRequest)
        .join(User, User.id == OutingRequest.student_id)
        .where(
            mine,
            OutingRequest.status == RequestStatus.PENDING,
            OutingRequest.day == ist_date(now),
        )
    )
    # By the outing's hostel, like the escalations list and resolving: a student who moved
    # since doesn't take the follow-up to the new hostel's badge.
    escalated = await session.scalar(
        select(func.count())
        .select_from(Escalation)
        .join(Outing, Outing.id == Escalation.outing_id)
        .where(mine_out, Escalation.resolved_at.is_(None))
    )
    # The corrections queue (app/services/corrections.py): students' asks and unrecorded returns.
    to_fix = await session.scalar(
        select(func.count())
        .select_from(Outing)
        .where(
            mine_out,
            Outing.left_at >= now - CORRECTABLE_FOR,
            or_(
                Outing.in_via == InVia.UNRECORDED,
                select(OutingCorrection.id)
                .where(
                    OutingCorrection.outing_id == Outing.id,
                    OutingCorrection.status == RequestStatus.PENDING,
                )
                .exists(),
            ),
        )
    )
    return AdminOverview(
        out_now=out_now or 0,
        overdue=overdue or 0,
        scans_today=accepted or 0,
        rejected_today=rejected or 0,
        active_gates=gates or 0,
        pending_requests=pending or 0,
        open_escalations=escalated or 0,
        corrections=to_fix or 0,
        open_help=(
            await session.scalar(
                select(func.count())
                .select_from(HelpRequest)
                .where(HelpRequest.handled_at.is_(None), staff.covers(HelpRequest.hostel_id))
            )
        )
        or 0,
    )


def _register_filters(hostel_id: uuid.UUID | None, q: str | None) -> list:
    """The register's own filters (on top of the office's scope): one hostel (the outing's,
    as everywhere in the register), and a name or roll number. A deleted account's outing
    matches by the name and roll number kept with it."""
    where = []
    if hostel_id is not None:
        where.append(Outing.hostel_id == hostel_id)
    if q:
        pattern = _like(q)
        where.append(
            or_(
                func.lower(func.coalesce(User.name, Outing.student_name, "")).like(
                    pattern, escape="\\"
                ),
                func.lower(func.coalesce(User.roll_no, Outing.student_roll_no, "")).like(
                    pattern, escape="\\"
                ),
            )
        )
    return where


async def open_outings(
    session: AsyncSession,
    staff: Staff,
    state: str,
    hostel_id: uuid.UUID | None = None,
    q: str | None = None,
) -> list[AdminOuting]:
    """Students currently out: `overdue`, `out` (not yet due) or `all`. Most urgent first.
    `back`: outings that ended today (IST), latest first, for the office to correct."""
    now = datetime.now(UTC)
    query = (
        select(Outing, User, Gate.name, Hostel.name)
        .outerjoin(User, User.id == Outing.student_id)  # a deleted account's record too
        .outerjoin(Gate, Gate.id == Outing.out_gate_id)
        .outerjoin(Hostel, Hostel.id == Outing.hostel_id)
        .where(staff.covers(Outing.hostel_id), *_register_filters(hostel_id, q))
        .limit(500)
    )
    if state == "back":
        rows = await session.execute(
            query.where(Outing.returned_at >= ist_midnight(now)).order_by(Outing.returned_at.desc())
        )
        return [_register_row(o, u, gate_name, hostel, now) for o, u, gate_name, hostel in rows]
    query = query.where(Outing.returned_at.is_(None)).order_by(Outing.expected_return_at)
    if state == "overdue":
        query = query.where(Outing.expected_return_at < now)
    elif state == "out":
        query = query.where(Outing.expected_return_at >= now)
    rows = await session.execute(query)
    return [_register_row(o, u, gate_name, hostel, now) for o, u, gate_name, hostel in rows]


def _register_row(
    o: Outing, u: User | None, gate_name: str | None, hostel: str | None, now: datetime
) -> AdminOuting:
    """`u` is None for a deleted account's outing: no id or email, the name and roll no. kept."""
    end = o.returned_at or now
    return AdminOuting(
        id=o.id,
        student_id=u.id if u is not None else None,
        name=student_name(o, u),
        email=u.email if u is not None else None,
        roll_no=student_roll_no(o, u),
        destination=o.destination,
        left_at=o.left_at,
        expected_return_at=o.expected_return_at,
        returned_at=o.returned_at,
        status=status_of(o, now),  # type: ignore[arg-type]
        late_minutes=max(0, int((end - o.expected_return_at).total_seconds() // 60)),
        out_via=o.out_via.value,
        out_gate=gate_name,
        in_via=o.in_via.value if o.in_via else None,
        hostel=hostel,
        late_reply=o.late_reply.value if o.late_reply else None,
        on_request=o.request_id is not None,
        original_return_at=o.original_return_at,
        running_late_minutes=o.running_late_minutes,
        running_late_reason=o.running_late_reason,
        running_late_at=o.running_late_at,
    )


async def late_today(
    session: AsyncSession,
    staff: Staff,
    hostel_id: uuid.UUID | None = None,
    q: str | None = None,
) -> list[AdminOuting]:
    """Everyone late today: back after their return time, or still out past it. Most late first.
    "Today" is the IST day the return time fell on, so 8 PM latecomers are tonight's list."""
    now = datetime.now(UTC)
    rows = await session.execute(
        select(Outing, User, Gate.name, Hostel.name)
        .outerjoin(User, User.id == Outing.student_id)  # a deleted account's record too
        .outerjoin(Gate, Gate.id == Outing.out_gate_id)
        .outerjoin(Hostel, Hostel.id == Outing.hostel_id)
        .where(
            staff.covers(Outing.hostel_id),
            *_register_filters(hostel_id, q),
            Outing.expected_return_at >= ist_midnight(now),
            Outing.expected_return_at < now,
            or_(Outing.returned_at.is_(None), Outing.returned_at > Outing.expected_return_at),
        )
        .limit(500)
    )
    late = [_register_row(o, u, g, h, now) for o, u, g, h in rows]
    return sorted(late, key=lambda r: r.late_minutes, reverse=True)


def ist_days(start: date, end: date) -> tuple[datetime, datetime]:
    """[start, end] as IST dates (inclusive), as the UTC instants [since, until)."""
    since = (datetime.combine(start, time()) - IST).replace(tzinfo=UTC)
    until = (datetime.combine(end + timedelta(days=1), time()) - IST).replace(tzinfo=UTC)
    return since, until


def _like(q: str) -> str:
    """A case-insensitive "contains" pattern; the user's own % and _ match only themselves."""
    escaped = q.strip().lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def name_or_roll(q: str):  # noqa: ANN201 - a SQL expression
    """Students whose name or roll number contains `q` (any case)."""
    pattern = _like(q)
    return or_(
        func.lower(User.name).like(pattern, escape="\\"),
        func.lower(func.coalesce(User.roll_no, "")).like(pattern, escape="\\"),
    )


async def scans(
    session: AsyncSession,
    staff: Staff,
    *,
    before: int | None,
    limit: int,
    gate_id: uuid.UUID | None,
    result: ScanResult | None,
    q: str | None = None,
    days: tuple[date, date] | None = None,
    student_id: uuid.UUID | None = None,
    hostel_id: uuid.UUID | None = None,
) -> AdminScanPage:
    """Newest first, `limit` at a time. `q`: a student's name or roll number. `days`: scans on
    these IST dates (inclusive). `student_id`: one student's (their record page). `hostel_id`:
    students living in that hostel now (the caller checks it is the office's own)."""
    query = (
        select(GateScan, User, Gate.name)
        .join(User, User.id == GateScan.user_id)
        .outerjoin(Gate, Gate.id == GateScan.gate_id)
        .where(staff.covers(User.hostel_id))
        .order_by(GateScan.id.desc())
        .limit(limit + 1)
    )
    if before is not None:
        query = query.where(GateScan.id < before)
    if gate_id is not None:
        query = query.where(GateScan.gate_id == gate_id)
    if result is not None:
        query = query.where(GateScan.result == result)
    if q:
        query = query.where(name_or_roll(q))
    if days is not None:
        since, until = ist_days(*days)
        query = query.where(GateScan.scanned_at >= since, GateScan.scanned_at < until)
    if student_id is not None:
        query = query.where(GateScan.user_id == student_id)
    if hostel_id is not None:
        query = query.where(User.hostel_id == hostel_id)
    rows = list(await session.execute(query))
    page = rows[:limit]
    return AdminScanPage(
        items=[
            AdminScan(
                id=s.id,
                student_id=u.id,
                name=u.name,
                roll_no=u.roll_no,
                gate=gate_name,
                direction=s.direction.value,
                result=s.result.value,
                distance_m=s.distance_m,
                accuracy_m=s.accuracy_m,
                scanned_at=s.scanned_at,
            )
            for s, u, gate_name in page
        ],
        next_before=page[-1][0].id if len(rows) > limit else None,
    )


def _ist(value: datetime | None) -> str:
    return (value.astimezone(UTC) + IST).strftime("%Y-%m-%d %H:%M") if value else ""


# The register download's columns, in order: plain words a hostel's management reads without
# a key (no "self"/"gate" codes), every time on the campus clock.
CSV_COLUMNS = (
    "Student",
    "Roll number",
    "Hostel",
    "Email",
    "Destination",
    "Left (IST)",
    "Left through",
    "Due back (IST)",
    "Back (IST)",
    "Came back through",
    "Status",
    "Minutes late",
    "Approved form",
)
# Excel opens a UTF-8 file without this mark as the PC's own code page, garbling names
# written in other scripts.
CSV_BOM = chr(0xFEFF)


def _through(via: Via | InVia | None, gate: str | None) -> str:
    """How a trip started or ended, in words (empty: not back yet)."""
    if via is None:
        return ""
    if via in (Via.GATE, InVia.GATE):
        return f"Gate scan at {gate}" if gate else "Gate scan"
    if via in (Via.SELF, InVia.SELF):
        return "App or website"
    if via == InVia.STAFF:
        return "Hostel office"
    return "Not recorded"  # InVia.UNRECORDED: they tapped out again on a later day


def _csv_status(o: Outing, late: int, now: datetime) -> str:
    match status_of(o, now):
        case "returned":
            return "Back late" if late > 0 else "Back on time"
        case "overdue":
            return "Late, not back"
        case _:
            return "Out"


async def outings_csv(session: AsyncSession, staff: Staff, start: date, end: date) -> str:
    """The register for [start, end] (IST dates, inclusive), oldest first."""
    since, until = ist_days(start, end)
    out_gate, in_gate = aliased(Gate), aliased(Gate)
    rows = await session.execute(
        select(Outing, User, out_gate.name, in_gate.name, Hostel.name)
        .outerjoin(User, User.id == Outing.student_id)  # a deleted account's record too
        .outerjoin(out_gate, out_gate.id == Outing.out_gate_id)
        .outerjoin(in_gate, in_gate.id == Outing.in_gate_id)
        .outerjoin(Hostel, Hostel.id == Outing.hostel_id)  # the hostel at the time
        .where(staff.covers(Outing.hostel_id), Outing.left_at >= since, Outing.left_at < until)
        .order_by(Outing.left_at)
    )
    buffer = io.StringIO()
    buffer.write(CSV_BOM)
    writer = csv.writer(buffer)
    writer.writerow(CSV_COLUMNS)
    now = datetime.now(UTC)
    for o, u, out_name, in_name, hostel in rows:
        end_at = o.returned_at or now
        late = max(0, int((end_at - o.expected_return_at).total_seconds() // 60))
        # Spreadsheet formula injection: every text cell someone typed (name, roll number,
        # hostel, destination, gate names) is neutralised.
        writer.writerow(
            [
                _safe(student_name(o, u)),
                _safe(student_roll_no(o, u) or ""),
                _safe(hostel or ""),
                _safe(u.email if u is not None else ""),
                _safe(o.destination or ""),
                _ist(o.left_at),
                _safe(_through(o.out_via, out_name)),
                _ist(o.expected_return_at),
                _ist(o.returned_at),
                _safe(_through(o.in_via, in_name)),
                _csv_status(o, late, now),
                late,
                "Yes" if o.request_id is not None else "No",
            ]
        )
    return buffer.getvalue()


FORMULA_STARTS = ("=", "+", "-", "@", "|", "%")
BREAKS = ("\t", "\r", "\n")


def _safe(cell: str) -> str:
    """A leading quote makes spreadsheets show the cell as text instead of running it. Some
    spreadsheets skip leading spaces, tabs and line breaks (in any mix) before reading a
    formula, so those count too, and a cell that starts with a break is quoted anyway."""
    risky = cell[:1] in BREAKS or cell.lstrip()[:1] in FORMULA_STARTS
    return f"'{cell}" if risky else cell


def _anyone_matching(q: str):  # noqa: ANN202 - a SQL expression
    """Name, email or roll number contains `q` (any case); `q`'s own % and _ are letters."""
    pattern = _like(q)
    return or_(
        func.lower(User.name).like(pattern, escape="\\"),
        User.email.like(pattern, escape="\\"),
        func.lower(func.coalesce(User.roll_no, "")).like(pattern, escape="\\"),
    )


ROLE_PAGE = 50  # people listed by role, per page
# The office list (students): at most this many in one answer. Callers that don't page (apps
# released before paging) get this many, as before; the website pages 50 at a time.
STUDENTS_MAX = 300


async def search_users(
    session: AsyncSession,
    q: str | None,
    *,
    roles: Sequence[UserRole] = (),
    after: uuid.UUID | None = None,
) -> list[AdminUser]:
    """A search (`q`): the best 20, staff first. With `roles`: everyone with one of them
    (matching `q` too, if given), ROLE_PAGE at a time by name; `after` is the last person of the
    page before (an unknown id is an empty page, never the first one again)."""
    # Unverified users are imported students who haven't set up yet: found too, so an admin
    # can send their link again.
    query = select(User)
    if q:
        query = query.where(_anyone_matching(q))
    if not roles:
        query = query.order_by(User.role.desc(), User.name).limit(20)
    else:
        query = query.where(User.role.in_(roles)).order_by(User.name, User.id).limit(ROLE_PAGE)
        if after is not None:
            mark = await session.get(User, after)
            if mark is None:
                return []
            query = query.where(tuple_(User.name, User.id) > tuple_(mark.name, mark.id))
    return await people(session, list(await session.scalars(query)))


async def person(session: AsyncSession, u: User) -> AdminUser:
    [one] = await people(session, [u])
    return one


async def people(session: AsyncSession, users: Sequence[User]) -> list[AdminUser]:
    """Each of `users` as People shows them, in order. Two queries at most, however many there
    are: every home hostel's name, then every warden's hostels (each warden's by name)."""
    home_ids = {u.hostel_id for u in users if u.hostel_id}
    homes: dict[uuid.UUID, str] = {}
    if home_ids:
        found = await session.execute(select(Hostel.id, Hostel.name).where(Hostel.id.in_(home_ids)))
        homes = {hostel_id: name for hostel_id, name in found}
    wardens = [u.id for u in users if u.role == UserRole.WARDEN]
    looked_after: dict[uuid.UUID, list[tuple[uuid.UUID, str]]] = {w: [] for w in wardens}
    if wardens:
        rows = await session.execute(
            select(WardenHostel.user_id, Hostel.id, Hostel.name)
            .join(WardenHostel, WardenHostel.hostel_id == Hostel.id)
            .where(WardenHostel.user_id.in_(wardens))
            .order_by(Hostel.name)
        )
        for user_id, hostel_id, name in rows:
            looked_after[user_id].append((hostel_id, name))
    out = []
    for u in users:
        hostels = looked_after.get(u.id, [])
        out.append(
            AdminUser(
                id=u.id,
                name=u.name,
                email=u.email,
                roll_no=u.roll_no,
                role=u.role.value,
                hostel_ids=[i for i, _ in hostels],
                hostels=[n for _, n in hostels],
                home_hostel_id=u.hostel_id,
                home_hostel=homes.get(u.hostel_id) if u.hostel_id else None,
                account=account_state(u),
            )
        )
    return out


async def students(
    session: AsyncSession,
    staff: Staff,
    hostel_id: uuid.UUID | None,
    q: str | None,
    account: str | None = None,
    roles: Sequence[UserRole] | None = None,
    *,
    after: uuid.UUID | None = None,
    limit: int = STUDENTS_MAX,
) -> list[StudentOut]:
    """People the office looks after: a hostel's students, or a search. A warden sees their
    own hostels' students only; an admin's search (or `account` list) also finds staff.
    `account`: "invited" (haven't set up yet) or "off" (turned off) only. `roles`: only these
    (the caller passes it for admins only; wardens and head wardens see students only).
    By name, `limit` at a time; `after` is the last person of the page before (an unknown id,
    or someone this office doesn't look after, is an empty page, never the first one again)."""
    query = (
        select(User, Hostel.name)
        .outerjoin(Hostel, Hostel.id == User.hostel_id)
        .where(staff.covers(User.hostel_id))  # imported students who haven't set up too
        .order_by(User.name, User.id)
        .limit(limit)
    )
    if after is not None:
        mark = await session.get(User, after)
        if mark is None or not staff.covers_student(mark):
            return []
        query = query.where(tuple_(User.name, User.id) > tuple_(mark.name, mark.id))
    if not staff.user.is_admin:  # wardens and head wardens: students, not staff
        query = query.where(User.role == UserRole.STUDENT)
    elif roles:
        query = query.where(User.role.in_(roles))
    if hostel_id is not None:
        query = query.where(User.hostel_id == hostel_id)
    if q:
        query = query.where(_anyone_matching(q))
    elif hostel_id is None and staff.every_hostel and account is None and not roles:
        query = query.where(User.hostel_id.is_not(None))  # no filter: everyone in a hostel
    if account == "invited":
        query = query.where(User.email_verified_at.is_(None), User.deactivated_at.is_(None))
    elif account == "off":
        query = query.where(User.deactivated_at.is_not(None))
    rows = (await session.execute(query)).all()
    now = datetime.now(UTC)
    open_outings = {
        o.student_id: o
        for o in await session.scalars(
            select(Outing).where(
                Outing.returned_at.is_(None), Outing.student_id.in_([u.id for u, _ in rows])
            )
        )
    }
    return [_student_out(u, hostel, open_outings.get(u.id), now) for u, hostel in rows]


def _student_out(u: User, hostel: str | None, open_: Outing | None, now: datetime) -> StudentOut:
    return StudentOut(
        id=u.id,
        name=u.name,
        email=u.email,
        roll_no=u.roll_no,
        role=u.role.value,
        hostel_id=u.hostel_id,
        hostel=hostel,
        phone=u.phone,
        emergency_name=u.emergency_name,
        emergency_relation=u.emergency_relation,
        emergency_phone=u.emergency_phone,
        status=status_of(open_, now) if open_ else "in",  # type: ignore[arg-type]
        account=account_state(u),
    )


def account_state(u: User) -> str:
    """invited: imported, no password chosen yet. reset: an admin reset the password and the
    student hasn't chosen a new one. (Self sign-ups are verified before their row exists.)
    off: the hostel office turned the account off (whatever its password state)."""
    if u.deactivated_at is not None:
        return "off"
    if u.email_verified_at is None:
        return "invited"
    return "active" if has_password(u) else "reset"


def _can_sign_in(u: User) -> bool:
    return account_state(u) == "active"


class MoveRefused(Exception):
    """A move the hostel office can't make; `status` and the message go back to them."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


async def move_student(
    session: AsyncSession, staff: Staff, student_id: uuid.UUID, hostel_id: uuid.UUID
) -> StudentOut:
    """Moves a student to another hostel. Students choose their hostel only once, so this is how
    a move happens: staff who look after both the old and the new hostel (a warden: their own
    hostels; head wardens and admins: any). Records of earlier outings stay with the hostel
    they happened in (outings.hostel_id)."""
    student = await session.get(User, student_id, with_for_update=True)
    if (
        student is None
        or student.role != UserRole.STUDENT
        or not staff.covers_hostel(student.hostel_id)
    ):
        raise MoveRefused(404, "No such student")  # someone else's: as if they didn't exist
    hostel = await session.get(Hostel, hostel_id)
    if hostel is None:
        raise MoveRefused(422, "Unknown hostel")
    if not staff.covers_hostel(hostel_id):
        raise MoveRefused(403, "You can only move students into hostels you look after")
    if student.hostel_id != hostel_id:
        if await rules_in_use(session, student):
            raise MoveRefused(
                409,
                "They're out or have an outing request for today. Move them once they're back "
                "and today's request is settled.",
            )
        student.hostel_id = hostel_id
        audit(session, staff.user, "student:move", f"{student.email} -> {hostel.name}")
        await session.commit()
    open_ = await session.scalar(
        select(Outing).where(Outing.student_id == student.id, Outing.returned_at.is_(None))
    )
    return _student_out(student, hostel.name, open_, datetime.now(UTC))


class NoHostels(Exception):
    """Refused: a warden needs at least one existing hostel."""


async def set_role(
    session: AsyncSession,
    actor: User,
    target: User,
    role: UserRole,
    hostel_ids: list[uuid.UUID] | None = None,
) -> User:
    """A warden gets exactly `hostel_ids`; any other role has no hostels of its own. Never
    gives or takes the developer role (scripts/make_developer.py does)."""
    if UserRole.DEVELOPER in (target.role, role):
        raise DeveloperLocked
    wanted = set(hostel_ids or []) if role == UserRole.WARDEN else set()
    if role == UserRole.WARDEN:
        found = set(await session.scalars(select(Hostel.id).where(Hostel.id.in_(wanted))))
        if not wanted or found != wanted:
            raise NoHostels
    current = await warden_hostel_ids(session, target.id)
    # Staff live in no hostel (a warden's hostels are warden_hostels): a promoted student leaves
    # their hostel's student list, gate scans list and counts (all by users.hostel_id). Their
    # past outings stay on the register and in the CSV under the hostel they were in then
    # (outings.hostel_id). Owner decision, 2026-11-08.
    leaves_hostel = role != UserRole.STUDENT and target.hostel_id is not None
    if target.role == role and current == wanted and not leaves_hostel:
        return target
    if target.role == UserRole.ADMIN and role != UserRole.ADMIN:
        # Lock the admin rows while counting: two admins demoting each other at the same moment
        # must not both see "2 admins" and leave none. Only admins who can sign in count: an
        # invite nobody has claimed yet (or a reset in progress) can't run the campus.
        admins = list(
            await session.scalars(select(User).where(User.role == UserRole.ADMIN).with_for_update())
        )
        if sum(1 for a in admins if a.id != target.id and _can_sign_in(a)) < 1:
            raise LastAdmin
    target.role = role
    if leaves_hostel:
        target.hostel_id = None
    await session.execute(delete(WardenHostel).where(WardenHostel.user_id == target.id))
    session.add_all(WardenHostel(user_id=target.id, hostel_id=h) for h in wanted)
    # Escalations they claimed in a hostel they no longer look after: the claim lapses.
    await clear_lapsed_claims(session)
    names = (
        sorted(await session.scalars(select(Hostel.name).where(Hostel.id.in_(wanted))))
        if wanted
        else []
    )
    audit(
        session,
        actor,
        f"role:{role.value}",
        f"{target.email} ({', '.join(names)})" if names else target.email,
    )
    await session.commit()
    return target
