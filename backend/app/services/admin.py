"""Admin reads and changes: who is out, gate scans, gates, campus settings, roles.

Admins see the register (who left, when, through which gate, whether verified), not live
locations or share data. The one exception is an open late escalation, which shows the
student's last known position (app/services/escalations.py; each read is logged on the share).
Changes are written to admin_audit.
"""

import csv
import io
import uuid
from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models import (
    AdminAudit,
    Escalation,
    Gate,
    GateScan,
    Hostel,
    Outing,
    OutingRequest,
    RequestStatus,
    ScanResult,
    User,
    UserRole,
)
from app.schemas import AdminOuting, AdminOverview, AdminScan, AdminScanPage, AdminUser
from app.services.outings import status_of
from app.services.rules import ist_date

IST = timedelta(hours=5, minutes=30)
MAX_EXPORT_DAYS = 92


class LastAdmin(Exception):
    """Refused: the campus would be left without an admin."""


def ist_midnight(now: datetime) -> datetime:
    local = now.astimezone(UTC) + IST
    return (datetime.combine(local.date(), time()) - IST).replace(tzinfo=UTC)


def audit(session: AsyncSession, actor: User, action: str, target: str) -> None:
    session.add(AdminAudit(actor_id=actor.id, action=action, target=target[:160]))


async def overview(session: AsyncSession) -> AdminOverview:
    now = datetime.now(UTC)
    since = ist_midnight(now)
    open_ = Outing.returned_at.is_(None)
    out_now = await session.scalar(
        select(func.count()).where(open_, Outing.expected_return_at >= now)
    )
    overdue = await session.scalar(
        select(func.count()).where(open_, Outing.expected_return_at < now)
    )
    accepted = await session.scalar(
        select(func.count()).where(
            GateScan.scanned_at >= since, GateScan.result == ScanResult.ACCEPTED
        )
    )
    rejected = await session.scalar(
        select(func.count()).where(
            GateScan.scanned_at >= since, GateScan.result != ScanResult.ACCEPTED
        )
    )
    gates = await session.scalar(select(func.count()).select_from(Gate).where(Gate.active))
    pending = await session.scalar(
        select(func.count()).where(
            OutingRequest.status == RequestStatus.PENDING, OutingRequest.day == ist_date(now)
        )
    )
    escalated = await session.scalar(
        select(func.count()).select_from(Escalation).where(Escalation.resolved_at.is_(None))
    )
    return AdminOverview(
        out_now=out_now or 0,
        overdue=overdue or 0,
        scans_today=accepted or 0,
        rejected_today=rejected or 0,
        active_gates=gates or 0,
        pending_requests=pending or 0,
        open_escalations=escalated or 0,
    )


async def open_outings(session: AsyncSession, state: str) -> list[AdminOuting]:
    """Students currently out: `overdue`, `out` (not yet due) or `all`. Most urgent first."""
    now = datetime.now(UTC)
    query = (
        select(Outing, User, Gate.name, Hostel.name)
        .join(User, User.id == Outing.student_id)
        .outerjoin(Gate, Gate.id == Outing.out_gate_id)
        .outerjoin(Hostel, Hostel.id == User.hostel_id)
        .where(Outing.returned_at.is_(None))
        .order_by(Outing.expected_return_at)
        .limit(500)
    )
    if state == "overdue":
        query = query.where(Outing.expected_return_at < now)
    elif state == "out":
        query = query.where(Outing.expected_return_at >= now)
    rows = await session.execute(query)
    return [_register_row(o, u, gate_name, hostel, now) for o, u, gate_name, hostel in rows]


def _register_row(
    o: Outing, u: User, gate_name: str | None, hostel: str | None, now: datetime
) -> AdminOuting:
    end = o.returned_at or now
    return AdminOuting(
        id=o.id,
        student_id=u.id,
        name=u.name,
        email=u.email,
        roll_no=u.roll_no,
        destination=o.destination,
        left_at=o.left_at,
        expected_return_at=o.expected_return_at,
        returned_at=o.returned_at,
        status=status_of(o, now),  # type: ignore[arg-type]
        late_minutes=max(0, int((end - o.expected_return_at).total_seconds() // 60)),
        out_via=o.out_via.value,
        out_gate=gate_name,
        hostel=hostel,
        late_reply=o.late_reply.value if o.late_reply else None,
        on_request=o.request_id is not None,
    )


async def late_today(session: AsyncSession) -> list[AdminOuting]:
    """Everyone late today: back after their return time, or still out past it. Most late first.
    "Today" is the IST day the return time fell on, so 8 PM latecomers are tonight's list."""
    now = datetime.now(UTC)
    rows = await session.execute(
        select(Outing, User, Gate.name, Hostel.name)
        .join(User, User.id == Outing.student_id)
        .outerjoin(Gate, Gate.id == Outing.out_gate_id)
        .outerjoin(Hostel, Hostel.id == User.hostel_id)
        .where(
            Outing.expected_return_at >= ist_midnight(now),
            Outing.expected_return_at < now,
            or_(Outing.returned_at.is_(None), Outing.returned_at > Outing.expected_return_at),
        )
        .limit(500)
    )
    late = [_register_row(o, u, g, h, now) for o, u, g, h in rows]
    return sorted(late, key=lambda r: r.late_minutes, reverse=True)


async def scans(
    session: AsyncSession,
    *,
    before: int | None,
    limit: int,
    gate_id: uuid.UUID | None,
    result: ScanResult | None,
) -> AdminScanPage:
    query = (
        select(GateScan, User, Gate.name)
        .join(User, User.id == GateScan.user_id)
        .outerjoin(Gate, Gate.id == GateScan.gate_id)
        .order_by(GateScan.id.desc())
        .limit(limit + 1)
    )
    if before is not None:
        query = query.where(GateScan.id < before)
    if gate_id is not None:
        query = query.where(GateScan.gate_id == gate_id)
    if result is not None:
        query = query.where(GateScan.result == result)
    rows = list(await session.execute(query))
    page = rows[:limit]
    return AdminScanPage(
        items=[
            AdminScan(
                id=s.id,
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


async def outings_csv(session: AsyncSession, start: date, end: date) -> str:
    """The register for [start, end] (IST dates, inclusive), oldest first."""
    since = (datetime.combine(start, time()) - IST).replace(tzinfo=UTC)
    until = (datetime.combine(end + timedelta(days=1), time()) - IST).replace(tzinfo=UTC)
    out_gate, in_gate = aliased(Gate), aliased(Gate)
    rows = await session.execute(
        select(Outing, User, out_gate.name, in_gate.name)
        .join(User, User.id == Outing.student_id)
        .outerjoin(out_gate, out_gate.id == Outing.out_gate_id)
        .outerjoin(in_gate, in_gate.id == Outing.in_gate_id)
        .where(Outing.left_at >= since, Outing.left_at < until)
        .order_by(Outing.left_at)
    )
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "Name",
            "Email",
            "Roll no.",
            "Destination",
            "Left (IST)",
            "Out via",
            "Out gate",
            "Due back (IST)",
            "Returned (IST)",
            "In via",
            "In gate",
            "Minutes late",
        ]
    )
    now = datetime.now(UTC)
    for o, u, out_name, in_name in rows:
        end_at = o.returned_at or now
        late = max(0, int((end_at - o.expected_return_at).total_seconds() // 60))
        # Spreadsheet formula injection: every text cell someone typed (name, roll number,
        # destination, gate names) is neutralised.
        writer.writerow(
            [
                _safe(u.name),
                _safe(u.email),
                _safe(u.roll_no or ""),
                _safe(o.destination or ""),
                _ist(o.left_at),
                o.out_via.value,
                _safe(out_name or ""),
                _ist(o.expected_return_at),
                _ist(o.returned_at),
                o.in_via.value if o.in_via else "",
                _safe(in_name or ""),
                late,
            ]
        )
    return buffer.getvalue()


FORMULA_STARTS = ("=", "+", "-", "@", "|", "%", "\t", "\r")


def _safe(cell: str) -> str:
    """A leading quote makes spreadsheets show the cell as text instead of running it."""
    return f"'{cell}" if cell[:1] in FORMULA_STARTS else cell


async def search_users(session: AsyncSession, q: str) -> list[AdminUser]:
    pattern = f"%{q.strip().lower()}%"
    rows = await session.scalars(
        select(User)
        .where(
            User.email_verified_at.is_not(None),
            or_(
                func.lower(User.name).like(pattern),
                User.email.like(pattern),
                func.lower(func.coalesce(User.roll_no, "")).like(pattern),
            ),
        )
        .order_by(User.role.desc(), User.name)
        .limit(20)
    )
    return [
        AdminUser(id=u.id, name=u.name, email=u.email, roll_no=u.roll_no, role=u.role.value)
        for u in rows
    ]


async def set_role(session: AsyncSession, actor: User, target: User, role: UserRole) -> User:
    if target.role == role:
        return target
    if role == UserRole.STUDENT:
        # Lock the admin rows while counting: two admins demoting each other at the same moment
        # must not both see "2 admins" and leave none.
        admins = list(
            await session.scalars(
                select(User.id).where(User.role == UserRole.ADMIN).with_for_update()
            )
        )
        if len(admins) <= 1:
            raise LastAdmin
    target.role = role
    audit(session, actor, f"role:{role.value}", target.email)
    await session.commit()
    return target
