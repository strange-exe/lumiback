"""Admin area (wardens / security): the live register, gate scans, gates, settings, roles."""

import uuid
from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated, Literal

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    Query,
    Request,
    Response,
    status,
)
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import (
    AdminUser,
    CurrentUser,
    HubDep,
    LimiterDep,
    MailerDep,
    SessionDep,
    SettingsDep,
    StaffUser,
    enforce,
)
from app.models import AdminAudit, CampusSettings, Gate, Hostel, ScanResult, User, UserRole
from app.push import PushMessage, count_everyone, push_everyone
from app.realtime import AccessChanged
from app.schemas import (
    AccountEditIn,
    AccountOn,
    AdminOuting,
    AdminOverview,
    AdminScanPage,
    AnnouncementIn,
    AnnouncementSent,
    AnnouncementStatus,
    AuditPage,
    CampusSettingsIO,
    GateCreated,
    GateIn,
    GateOut,
    GatePatch,
    PasswordLinkOut,
    PersonIn,
    Report,
    RoleIn,
    StudentHostelIn,
    StudentImportIn,
    StudentImportOut,
    StudentImportRow,
    StudentOut,
)
from app.schemas import (
    AdminUser as AdminUserOut,
)
from app.security.gate_codes import new_kiosk_token
from app.security.rate_limit import Limit
from app.services import account_links, accounts, reports, rules, student_import
from app.services import admin as svc
from app.services.gates import (
    QuietHours,
    campus_settings,
    kiosk_health,
    quiet_hours,
    used_gate_ids,
)
from app.services.staff import Staff

router = APIRouter(prefix="/admin", tags=["admin"])

IMPORT_CHECKS = Limit(max_hits=60, window_seconds=3600)
IMPORT_CONFIRMS = Limit(max_hits=10, window_seconds=3600)
PASSWORD_LINKS = Limit(max_hits=30, window_seconds=3600)
PEOPLE_ADDED = Limit(max_hits=60, window_seconds=3600)

NOT_FOUND = HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found")
NAME_TAKEN = HTTPException(status.HTTP_409_CONFLICT, detail="A gate with that name already exists")


@router.get("/overview")
async def overview(staff: StaffUser, session: SessionDep) -> AdminOverview:
    return await svc.overview(session, staff)


Search = Annotated[str | None, Query(min_length=2, max_length=100)]


def own_hostel(staff: Staff, hostel_id: uuid.UUID | None) -> uuid.UUID | None:
    """A hostel filter must be one of the office's own hostels: another one is a 404, as if it
    didn't exist (the same answer as for an unknown id)."""
    if hostel_id is not None and not staff.covers_hostel(hostel_id):
        raise NOT_FOUND
    return hostel_id


def day_range(start: date | None, end: date | None) -> tuple[date, date] | None:
    """An optional range of IST dates; one end alone is the open range to/from it."""
    if start is None and end is None:
        return None
    first, last = start or date(2000, 1, 1), end or date(2999, 12, 31)
    # Dates at the ends of the calendar overflow when converted to IST instants (a 500).
    if first.year < 2000 or last.year > 2999:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Choose real dates")
    if last < first:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, detail="The end date is before the start date"
        )
    return first, last


@router.get("/outings")
async def open_outings(
    staff: StaffUser,
    session: SessionDep,
    state: Literal["all", "out", "overdue", "back"] = "all",
    hostel_id: uuid.UUID | None = None,
    q: Search = None,
) -> list[AdminOuting]:
    """`hostel_id`: one of the office's hostels (the outing's hostel). `q`: name or roll no."""
    return await svc.open_outings(session, staff, state, own_hostel(staff, hostel_id), q)


@router.get("/late-today")
async def late_today(
    staff: StaffUser,
    session: SessionDep,
    hostel_id: uuid.UUID | None = None,
    q: Search = None,
) -> list[AdminOuting]:
    """Tonight's latecomers: back after their return time, or still out past it."""
    return await svc.late_today(session, staff, own_hostel(staff, hostel_id), q)


@router.get("/outings.csv")
async def outings_csv(
    staff: StaffUser,
    session: SessionDep,
    start: Annotated[date, Query(alias="from")],
    end: Annotated[date, Query(alias="to")],
) -> Response:
    if end < start or (end - start).days >= svc.MAX_EXPORT_DAYS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Choose a range of at most {svc.MAX_EXPORT_DAYS} days",
        )
    # Dates at the ends of the calendar overflow when converted to IST instants (a 500).
    if start.year < 2000 or end.year > 2999:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Choose real dates")
    body = await svc.outings_csv(session, staff, start, end)
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="outings-{start}-to-{end}.csv"',
            **NO_STORE,
        },
    )


def report_range(start: date | None, end: date | None) -> tuple[date, date]:
    """Both ends or neither (the last 30 IST days, today included); at most a year."""
    if start is None and end is None:
        end = rules.ist_date(datetime.now(UTC))
        return end - timedelta(days=reports.DEFAULT_DAYS - 1), end
    if start is None or end is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Choose both a start and an end date"
        )
    first, last = day_range(start, end) or (start, end)
    if (last - first).days >= reports.MAX_DAYS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Choose a range of at most {reports.MAX_DAYS} days",
        )
    return first, last


ReportFrom = Annotated[date | None, Query(alias="from")]
ReportTo = Annotated[date | None, Query(alias="to")]
# The office's records leave the API only for the person who asked: no shared or browser cache
# keeps a copy (a hostel PC's next user, a proxy).
NO_STORE = {"Cache-Control": "private, no-store"}


@router.get("/reports")
async def report(
    staff: StaffUser,
    session: SessionDep,
    response: Response,
    start: ReportFrom = None,
    end: ReportTo = None,
) -> Report:
    """Per-hostel numbers and a weekly trend for a range of IST days (default: the last 30).
    Every hostel for admins, head wardens and developers; a warden's own for a warden."""
    first, last = report_range(start, end)
    response.headers.update(NO_STORE)
    return await reports.build(session, staff, first, last)


@router.get("/reports.csv")
async def report_csv(
    staff: StaffUser, session: SessionDep, start: ReportFrom = None, end: ReportTo = None
) -> Response:
    first, last = report_range(start, end)
    body = reports.to_csv(await reports.build(session, staff, first, last))
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="report-{first}-to-{last}.csv"',
            **NO_STORE,
        },
    )


@router.get("/scans")
async def scans(
    staff: StaffUser,
    session: SessionDep,
    before: Annotated[int | None, Query(ge=1, le=2**63 - 1)] = None,  # inside BIGINT: 422, not 500
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    gate_id: uuid.UUID | None = None,
    result: ScanResult | None = None,
    q: Search = None,
    start: Annotated[date | None, Query(alias="from")] = None,
    end: Annotated[date | None, Query(alias="to")] = None,
) -> AdminScanPage:
    """`q`: a student's name or roll number. `from`/`to`: IST dates, inclusive."""
    return await svc.scans(
        session,
        staff,
        before=before,
        limit=limit,
        gate_id=gate_id,
        result=result,
        q=q,
        days=day_range(start, end),
    )


# ---------- gates ----------


@router.get("/gates")
async def list_gates(staff: StaffUser, session: SessionDep) -> list[GateOut]:
    """Readable by wardens too (the scan log filters by gate); changing gates is admin-only,
    and so is kiosk health (left out for wardens)."""
    gates = list(await session.scalars(select(Gate).order_by(Gate.name)))
    used = await used_gate_ids(session)
    quiet = quiet_hours(await campus_settings(session))
    return [_gate_view(g, g.id in used, quiet, staff.user.is_admin) for g in gates]


def _gate_view(gate: Gate, used: bool, quiet: QuietHours | None, admin: bool) -> GateOut:
    out = GateOut.model_validate(gate).model_copy(update={"used": used})
    if not admin:
        return out.model_copy(update={"kiosk_seen_at": None, "kiosk": None})
    return out.model_copy(update={"kiosk": kiosk_health(gate, quiet, datetime.now(UTC))})


async def _gate_out(session: SessionDep, gate: Gate) -> GateOut:
    """A gate as answered to an admin's change."""
    used = bool(await used_gate_ids(session, gate.id))
    quiet = quiet_hours(await campus_settings(session))
    return _gate_view(gate, used, quiet, admin=True)


@router.post("/gates", status_code=status.HTTP_201_CREATED)
async def create_gate(body: GateIn, me: AdminUser, session: SessionDep) -> GateCreated:
    token, token_hash = new_kiosk_token()
    gate = Gate(
        name=body.name,
        lat=body.lat,
        lng=body.lng,
        radius_m=body.radius_m,
        kiosk_token_hash=token_hash,
    )
    session.add(gate)
    svc.audit(session, me, "gate:create", body.name)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise NAME_TAKEN from None
    await session.refresh(gate)
    return GateCreated(gate=await _gate_out(session, gate), kiosk_token=token)


@router.patch("/gates/{gate_id}")
async def update_gate(
    gate_id: uuid.UUID, body: GatePatch, me: AdminUser, session: SessionDep
) -> GateOut:
    gate = await session.get(Gate, gate_id)
    if gate is None:
        raise NOT_FOUND
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    for field, value in changes.items():
        setattr(gate, field, value)
    if changes:
        svc.audit(session, me, "gate:update", f"{gate.name}: {', '.join(sorted(changes))}")
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise NAME_TAKEN from None
    await session.refresh(gate)
    return await _gate_out(session, gate)


@router.delete("/gates/{gate_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_gate(gate_id: uuid.UUID, me: AdminUser, session: SessionDep) -> Response:
    """Only a gate nobody has used (added by mistake, a test gate). A used gate stays, because
    scans and outings name it: switch it off instead. The row lock makes a scan arriving at that
    moment wait, then fail on the missing gate, rather than be recorded against nothing."""
    gate = await session.get(Gate, gate_id, with_for_update=True)
    if gate is None:
        raise NOT_FOUND
    if await used_gate_ids(session, gate.id):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="This gate has been used, so it stays for the records. Switch it off instead.",
        )
    svc.audit(session, me, "gate:remove", gate.name)
    await session.delete(gate)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/gates/{gate_id}/kiosk-token")
async def rotate_kiosk_token(gate_id: uuid.UUID, me: AdminUser, session: SessionDep) -> GateCreated:
    """A new kiosk link (e.g. a tablet was lost). The old one stops working immediately."""
    gate = await session.get(Gate, gate_id)
    if gate is None:
        raise NOT_FOUND
    token, gate.kiosk_token_hash = new_kiosk_token()
    svc.audit(session, me, "gate:kiosk-token", gate.name)
    await session.commit()
    await session.refresh(gate)
    return GateCreated(gate=await _gate_out(session, gate), kiosk_token=token)


# ---------- settings ----------


def _hhmm(value: time | None) -> str | None:
    return value.strftime("%H:%M") if value is not None else None


def _time(value: str | None) -> time | None:
    if value is None:
        return None
    hours, minutes = (int(x) for x in value.split(":"))
    return time(hours, minutes)


def _settings_out(row: CampusSettings) -> CampusSettingsIO:
    return CampusSettingsIO(
        curfew=row.curfew.strftime("%H:%M"),
        scan_retention_days=row.scan_retention_days,
        kiosk_quiet_from=_hhmm(row.kiosk_quiet_from),
        kiosk_quiet_until=_hhmm(row.kiosk_quiet_until),
        request_remind_minutes=row.request_remind_minutes,
        request_backup_minutes=row.request_backup_minutes,
        escalation_realert_minutes=row.escalation_realert_minutes,
        escalation_takeover_minutes=row.escalation_takeover_minutes,
    )


# The follow-up timings (services/alerts.py) and how the audit log names each.
TIMINGS = {
    "request_remind_minutes": "remind",
    "request_backup_minutes": "backup",
    "escalation_realert_minutes": "re-alert",
    "escalation_takeover_minutes": "hand over",
}


@router.get("/settings")
async def get_settings(_: AdminUser, session: SessionDep) -> CampusSettingsIO:
    row = await campus_settings(session)
    await session.commit()
    return _settings_out(row)


@router.put("/settings")
async def put_settings(
    body: CampusSettingsIO, me: AdminUser, session: SessionDep
) -> CampusSettingsIO:
    """Quiet hours change only when the body names them (both, or both null for off), so a
    page that doesn't know them leaves them as they are."""
    row = await campus_settings(session)
    if body.curfew is not None:  # older admin pages still send it
        row.curfew = _time(body.curfew)  # type: ignore[assignment]
    row.scan_retention_days = body.scan_retention_days
    what = f"keep scans {body.scan_retention_days} d"
    if {"kiosk_quiet_from", "kiosk_quiet_until"} & body.model_fields_set:
        row.kiosk_quiet_from = _time(body.kiosk_quiet_from)
        row.kiosk_quiet_until = _time(body.kiosk_quiet_until)
        what += (
            f", kiosks quiet {body.kiosk_quiet_from}-{body.kiosk_quiet_until}"
            if body.kiosk_quiet_from
            else ", kiosks always on"
        )
    changed = []
    for field, label in TIMINGS.items():
        value = getattr(body, field)
        if value is not None and value != getattr(row, field):
            setattr(row, field, value)
            changed.append(f"{label} {value} min")
    if changed:
        what += ", " + ", ".join(changed)
    row.updated_at = datetime.now(UTC)
    svc.audit(session, me, "settings", what)
    await session.commit()
    return _settings_out(row)


# ---------- audit log ----------


@router.get("/audit")
async def audit_log(
    _: AdminUser,
    session: SessionDep,
    before: Annotated[int | None, Query(ge=1, le=2**63 - 1)] = None,  # inside BIGINT: 422, not 500
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    area: Literal[svc.AUDIT_AREAS] | None = None,  # type: ignore[valid-type]
    q: Search = None,
    start: Annotated[date | None, Query(alias="from")] = None,
    end: Annotated[date | None, Query(alias="to")] = None,
) -> AuditPage:
    """Who changed what, newest first: admins and developers only, and read-only (nothing
    writes here; every change elsewhere adds its own row)."""
    return await svc.audit_log(
        session, before=before, limit=limit, area=area, q=q, days=day_range(start, end)
    )


# ---------- update announcements (developers) ----------
#
# Owner, 2026-11-08: "add an option on dev roles which allows them to send the notification
# of the released update don't send it directly". So this request is the only way one goes
# out: a developer types it and confirms it. Nothing sends it on its own (no release, deploy,
# start-up, sweep or script), one at a time (under a lock), audited, never emailed. The daily
# limit was dropped on 2026-11-09 (owner: "No timeout in announcements, it's just better for
# dev").

UPDATES_CHANNEL = "app-updates"  # the app's "App updates" Android channel (mutable)
ANNOUNCE_ACTION = "announce:update"
ANNOUNCE_LOCK = 7_316_011  # pg_advisory_xact_lock key: one announcement checked at a time


async def get_developer(user: CurrentUser) -> User:
    if user.role != UserRole.DEVELOPER:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Developers only")
    return user


DeveloperUser = Annotated[User, Depends(get_developer)]


@router.get("/announcements")
async def announcements(_: DeveloperUser, session: SessionDep) -> AnnouncementStatus:
    # next_at stays in the answer, always null (allowed now): 1.18.x apps read it.
    last = await session.scalar(
        select(func.max(AdminAudit.at)).where(AdminAudit.action == ANNOUNCE_ACTION)
    )
    return AnnouncementStatus(last_at=last, next_at=None)


# 200, not 202: the clients read the body (how many phones), and both treat 202 as empty.
@router.post("/announcements")
async def announce(
    body: AnnouncementIn,
    me: DeveloperUser,
    session: SessionDep,
    request: Request,
    tasks: BackgroundTasks,
) -> AnnouncementSent:
    """One push to every phone with the app, on the "App updates" channel, tapped to fetch the
    update. Sent after the response, in Expo's batches. A server without push refuses before
    anything is logged. No daily limit (owner, 2026-11-09: "No timeout in announcements, it's
    just better for dev"); the confirm step in each client is the guard."""
    sender = request.app.state.push
    if sender is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Push notifications aren't set up on this server, so nothing was sent.",
        )
    # Held until this transaction ends: a second request waits for this one's audit row and
    # count, so two at once are two whole announcements, one after the other.
    await session.execute(select(func.pg_advisory_xact_lock(ANNOUNCE_LOCK)))
    svc.audit(session, me, ANNOUNCE_ACTION, body.title)
    devices = await count_everyone(session, UPDATES_CHANNEL)
    await session.commit()
    tasks.add_task(
        push_everyone,
        request.app.state.sessionmaker,
        sender,
        PushMessage(title=body.title, body=body.body, channel=UPDATES_CHANNEL, kind="app-update"),
    )
    return AnnouncementSent(devices=devices, next_at=None)


# ---------- people ----------


@router.get("/users")
async def search_users(
    _: AdminUser, session: SessionDep, q: Annotated[str, Query(min_length=2, max_length=100)]
) -> list[AdminUserOut]:
    return await svc.search_users(session, q)


@router.get("/students")
async def list_students(
    staff: StaffUser,
    session: SessionDep,
    hostel_id: uuid.UUID | None = None,
    q: Annotated[str | None, Query(min_length=2, max_length=100)] = None,
    account: Literal["invited", "off"] | None = None,
) -> list[StudentOut]:
    """A hostel's students (a warden: their own hostels only), with contacts and who's out.
    `account`: only those who haven't set up yet, or only accounts turned off."""
    if hostel_id is not None and staff.hostels is not None and hostel_id not in staff.hostels:
        raise NOT_FOUND
    return await svc.students(session, staff, hostel_id, q, account)


@router.post("/students/{user_id}/hostel")
async def move_student(
    user_id: uuid.UUID, body: StudentHostelIn, staff: StaffUser, session: SessionDep
) -> StudentOut:
    """Move a student to another hostel: they can't once they've chosen (see /profile)."""
    try:
        return await svc.move_student(session, staff, user_id, body.hostel_id)
    except svc.MoveRefused as e:
        raise HTTPException(e.status, detail=str(e)) from None


@router.post("/students/import")
async def import_students(
    body: StudentImportIn,
    me: AdminUser,
    session: SessionDep,
    settings: SettingsDep,
    limiter: LimiterDep,
    request: Request,
    tasks: BackgroundTasks,
) -> StudentImportOut:
    """Adds students from a CSV. Without `confirm`, only checks every row. With it, checks
    again (the file is never trusted from an earlier check), adds the new rows, and emails
    each new student a link to choose a password, after the response."""
    await enforce(
        limiter, "import:admin", str(me.id), IMPORT_CONFIRMS if body.confirm else IMPORT_CHECKS
    )
    try:
        rows = await student_import.check(session, body.csv, settings)
    except student_import.ImportProblem as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(e)) from None
    added: set[str] = set()
    if body.confirm:
        pepper = settings.code_pepper.get_secret_value()
        created = await student_import.save(session, rows, pepper, me.id)
        if created:
            staff = sum(
                r.role is not UserRole.STUDENT
                for r in rows
                if r.email in {c.email for c in created}
            )
            svc.audit(session, me, "people:import", f"{len(created)} accounts ({staff} staff)")
            await session.commit()
            tasks.add_task(
                student_import.send_invites,
                request.app.state.sessionmaker,
                request.app.state.mailer,
                created,
                settings.web_url,
                pepper,
            )
        added = {c.email for c in created}
    out = [
        StudentImportRow(
            line=r.line,
            student_id=r.student_id,
            name=r.name,
            email=r.email,
            hostel=r.hostel,
            status="added" if r.email in added and r.status == "new" else r.status,
            error=r.error,
            role=r.role.value,
        )
        for r in rows
    ]
    return StudentImportOut(
        rows=out,
        added=len(added),
        new=0 if body.confirm else sum(r.status == "new" for r in rows),
        existing=sum(r.status == "exists" for r in rows),
        errors=sum(r.status == "error" for r in rows),
    )


@router.post("/people", status_code=status.HTTP_201_CREATED)
async def add_person(
    body: PersonIn,
    me: AdminUser,
    session: SessionDep,
    settings: SettingsDep,
    limiter: LimiterDep,
    request: Request,
    tasks: BackgroundTasks,
) -> StudentImportRow:
    """Adds one person (a student or staff), checked exactly like a row of the CSV import, and
    emails them a link to choose a password after the response."""
    await enforce(limiter, "people:add", str(me.id), PEOPLE_ADDED)
    hostel_name = ""
    if body.hostel_id is not None:
        hostel = await session.get(Hostel, body.hostel_id)
        if hostel is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Unknown hostel")
        hostel_name = hostel.name
    fields = {
        "_line": "1",
        "name": body.name,
        "role": body.role.replace("_", " "),
        "student_id": body.student_id or "",
        "email": body.email or "",
        "hostel": hostel_name,
        "phone": body.phone or "",
        "parent_name": body.parent_name or "",
        "parent_phone": body.parent_phone or "",
    }
    raw = {k: v.strip() for k, v in fields.items()}
    [row] = await student_import.check_rows(session, [raw], settings)
    if row.status == "error":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=row.error)
    pepper = settings.code_pepper.get_secret_value()
    created = (
        await student_import.save(session, [row], pepper, me.id) if row.status == "new" else []
    )
    if not created:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="An account already uses this email")
    svc.audit(session, me, "people:add", f"{row.email} ({row.role.value})")
    await session.commit()
    tasks.add_task(
        student_import.send_invites,
        request.app.state.sessionmaker,
        request.app.state.mailer,
        created,
        settings.web_url,
        pepper,
    )
    return StudentImportRow(
        line=1,
        student_id=row.student_id,
        name=row.name,
        email=row.email,
        hostel=row.hostel,
        status="added",
        error=None,
        role=row.role.value,
    )


@router.post("/users/{user_id}/password-link")
async def send_password_link(
    user_id: uuid.UUID,
    me: AdminUser,
    session: SessionDep,
    settings: SettingsDep,
    limiter: LimiterDep,
    mailer: MailerDep,
    first_only: bool = False,
) -> PasswordLinkOut:
    """Emails anyone (students and staff) a one-time link to choose a password: a first one
    if they were imported and haven't set up (the link again), otherwise a reset, which stops
    their old password working and signs them out everywhere.

    `first_only=true` (the People list's bulk "send the set-up link again") refuses with 409
    instead of resetting someone who has set up, decided here per person, not from a list."""
    target = await session.get(User, user_id)
    if target is None:
        raise NOT_FOUND
    if target.id == me.id:
        # It would sign this admin out mid-task; their own password goes through Forgot.
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="To change your own password, use Forgot password on the sign-in page",
        )
    if target.role == UserRole.DEVELOPER:  # a reset would sign them out everywhere
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail=svc.DEVELOPER_LOCKED)
    if not target.active:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="This account is turned off. Turn it on first."
        )
    if first_only and target.email_verified:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Not sent: they've already set up their account.",
        )
    await enforce(limiter, "password-link:admin", str(me.id), PASSWORD_LINKS)
    pepper = settings.code_pepper.get_secret_value()
    email, name, uid = target.email, target.name, target.id
    purpose, token = await account_links.reset(session, target, pepper, me.id)
    svc.audit(session, me, f"password:{purpose.value}", email)
    await session.commit()
    try:
        await account_links.send(
            session,
            mailer,
            user_id=uid,
            to=email,
            name=name,
            purpose=purpose,
            token=token,
            web_url=settings.web_url,
            pepper=pepper,
        )
    except account_links.EmailNotSent:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail="The email couldn't be sent. Try again in a minute.",
        ) from None
    return PasswordLinkOut(kind=purpose.value, email=email)  # type: ignore[arg-type]


@router.post("/users/{user_id}/role")
async def set_role(
    user_id: uuid.UUID, body: RoleIn, me: AdminUser, session: SessionDep
) -> AdminUserOut:
    # Invited accounts count too: an admin can correct an imported role before it's claimed.
    target = await session.get(User, user_id)
    if target is None:
        raise NOT_FOUND
    try:
        await svc.set_role(session, me, target, UserRole(body.role), body.hostel_ids)
    except svc.DeveloperLocked:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail=svc.DEVELOPER_LOCKED) from None
    except svc.LastAdmin:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="Make someone else an admin first"
        ) from None
    except svc.NoHostels:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Choose at least one hostel for a warden"
        ) from None
    return await svc.person(session, target)


# ---------- account controls (see services/accounts.py for who may do what) ----------


@router.patch("/users/{user_id}")
async def edit_account(
    user_id: uuid.UUID,
    body: AccountEditIn,
    staff: StaffUser,
    session: SessionDep,
    settings: SettingsDep,
    mailer: MailerDep,
) -> AdminUserOut:
    """Corrects someone's name, roll no., phone or (admins only) email. A new email address
    ends the password and gets a set-password link (see services/accounts.py)."""
    sent = body.model_fields_set
    if "name" in sent and body.name is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="A name is needed")
    if "email" in sent and body.email is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="An email is needed")
    changes = accounts.Changes(
        name=body.name,
        email=body.email,
        roll_no=body.roll_no,
        roll_no_sent="roll_no" in sent,
        phone=body.phone,
        phone_sent="phone" in sent,
    )
    try:
        target, link = await accounts.edit(session, staff, user_id, changes, settings)
    except accounts.Refused as e:
        raise HTTPException(e.status, detail=str(e)) from None
    if link is not None:
        purpose, token = link
        try:
            await account_links.send(
                session,
                mailer,
                user_id=target.id,
                to=target.email,
                name=target.name,
                purpose=purpose,
                token=token,
                web_url=settings.web_url,
                pepper=settings.code_pepper.get_secret_value(),
            )
        except account_links.EmailNotSent:
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY,
                detail=(
                    "The email address was changed, but the set-password email couldn't be "
                    "sent. Send it again from their page in a minute."
                ),
            ) from None
    return await svc.person(session, target)


@router.post("/users/{user_id}/active")
async def turn_account(
    user_id: uuid.UUID, body: AccountOn, staff: StaffUser, session: SessionDep, hub: HubDep
) -> AdminUserOut:
    """Turns an account off (signed out everywhere, history kept) or back on."""
    try:
        if body.on:
            await accounts.reactivate(session, staff, user_id)
        else:
            for share_id in await accounts.deactivate(session, staff, user_id):
                await hub.publish(AccessChanged(share_id))  # open streams re-check and end
    except accounts.Refused as e:
        raise HTTPException(e.status, detail=str(e)) from None
    target = await session.get(User, user_id)
    if target is None:
        raise NOT_FOUND
    return await svc.person(session, target)


@router.delete("/users/{user_id}/invite", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_invite(user_id: uuid.UUID, staff: StaffUser, session: SessionDep) -> Response:
    """Deletes an imported account nobody has set up yet (a wrong row, someone who left)."""
    try:
        await accounts.cancel_invite(session, staff, user_id)
    except accounts.Refused as e:
        raise HTTPException(e.status, detail=str(e)) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)
