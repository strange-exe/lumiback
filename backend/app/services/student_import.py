"""Admins add people in bulk from a CSV (a spreadsheet saved as CSV): students, and staff.

Columns, matched by header and in any order (other columns are ignored):
  name: required. student_id (or "roll no", "student id"): required for students.
  phone, parent's name, parent's number (or "number"), hostel, email, role: optional
role is student (blank), warden, head warden or admin; a warden's hostel is the one they look
after (required). The email defaults to <student_id>@<the first allowed domain> (GEU addresses
are the roll number); staff without a student ID need the email column. Every row is checked
first; nothing is saved unless the admin confirms, and rows with a problem or an existing
account are skipped. New accounts get no password: each is emailed a one-time link to choose
one (services/account_links.py).
"""

import asyncio
import csv
import io
import logging
import re
import uuid
from dataclasses import dataclass
from typing import Annotated, Literal

from pydantic import BaseModel, EmailStr, StringConstraints, ValidationError
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.email import Mailer
from app.models import Hostel, LinkPurpose, PendingRegistration, User, UserRole, WardenHostel
from app.schemas import Name, PersonName, Phone
from app.services import account_links
from app.services.verification import email_allowed

logger = logging.getLogger(__name__)

BOM = chr(0xFEFF)  # Excel starts its UTF-8 CSVs with one
MAX_BYTES = 512 * 1024
MAX_ROWS = 2000
SEND_GAP_SECONDS = 0.6  # the email provider allows a few messages a second

HEADERS = {
    "student_id": ("student_id", "student id", "studentid", "roll_no", "roll no", "roll number"),
    "name": ("name", "student name", "full name"),
    "phone": ("phone", "phone number", "phone no", "mobile", "mobile number", "student phone"),
    "parent_name": ("parent's name", "parents name", "parent name", "guardian name"),
    "parent_phone": (
        "number",
        "parent's number",
        "parents number",
        "parent number",
        "parent phone",
        "parent's phone",
        "guardian phone",
        "guardian number",
    ),
    "hostel": ("hostel", "hostel name"),
    "email": ("email", "email id", "email address"),
    "role": ("role", "designation", "type"),
}
ROLES = {
    "student": UserRole.STUDENT,
    "warden": UserRole.WARDEN,
    "head warden": UserRole.HEAD_WARDEN,
    "head_warden": UserRole.HEAD_WARDEN,
    "headwarden": UserRole.HEAD_WARDEN,
    "admin": UserRole.ADMIN,
}
ALIASES = {alias: key for key, names in HEADERS.items() for alias in names}

StudentId = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[A-Za-z0-9]{3,32}$")]


class ImportProblem(Exception):
    """The file as a whole can't be read (shown to the admin as is)."""


class _Row(BaseModel):
    student_id: StudentId | None = None  # required for students (checked in `check`)
    name: Name
    phone: Phone | None = None
    parent_name: PersonName | None = None
    parent_phone: Phone | None = None
    email: EmailStr | None = None


@dataclass
class Row:
    line: int  # the line in the file, counting the header as line 1
    student_id: str
    name: str
    email: str
    hostel: str | None
    status: Literal["new", "exists", "error"]
    error: str | None = None
    role: UserRole = UserRole.STUDENT
    # Saved for "new" rows only.
    phone: str | None = None
    parent_name: str | None = None
    parent_phone: str | None = None
    hostel_id: uuid.UUID | None = None


def _key(header: str) -> str | None:
    h = re.sub(r"\s+", " ", header.strip().strip(BOM).lower().replace("_", " "))
    return ALIASES.get(h) or ALIASES.get(h.replace(" ", "_"))


def _hostel_key(name: str) -> str:
    return re.sub(r"\s+", " ", name.strip()).lower()


def _first_error(e: ValidationError) -> str:
    err = e.errors()[0]
    field = {
        "student_id": "Student ID",
        "name": "Name",
        "phone": "Phone",
        "parent_name": "Parent's name",
        "parent_phone": "Parent's number",
        "email": "Email",
    }.get(str(err["loc"][0]) if err["loc"] else "", "Row")
    message = str(err.get("msg", "is not valid")).removeprefix("Value error, ")
    if err["type"] == "string_pattern_mismatch":
        message = "should be 3 to 32 letters or digits"
    elif err["type"] == "missing":
        message = "is missing"
    return f"{field}: {message}"


def read(data: str) -> list[dict[str, str]]:
    """The file's rows as {column: value}, by the known headers. Raises ImportProblem."""
    if len(data.encode()) > MAX_BYTES:
        raise ImportProblem("The file is larger than 512 KB. Split it into smaller files.")
    if "\x00" in data:
        raise ImportProblem("This doesn't look like a CSV file. Save the sheet as CSV.")
    try:
        sample = data[:4096]
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t") if sample.strip() else csv.excel
    except csv.Error:
        dialect = csv.excel
    reader = csv.reader(io.StringIO(data.lstrip(BOM)), dialect)
    try:
        header = next(reader)
    except (StopIteration, csv.Error):
        raise ImportProblem("The file is empty.") from None
    columns = [_key(h) for h in header]
    if "name" not in columns:
        raise ImportProblem('The first row needs a "name" column.')
    if "student_id" not in columns and "email" not in columns:
        raise ImportProblem('The first row needs a "student_id" or an "email" column.')
    rows: list[dict[str, str]] = []
    try:
        for values in reader:
            if not any(v.strip() for v in values):
                continue  # blank line
            if len(rows) >= MAX_ROWS:
                raise ImportProblem(f"The file has more than {MAX_ROWS} students. Split it.")
            row = {"_line": str(reader.line_num)}
            for key, value in zip(columns, values, strict=False):
                if key and key not in row:
                    row[key] = value.strip()
            rows.append(row)
    except csv.Error as e:
        raise ImportProblem(f"Line {reader.line_num} can't be read: {e}.") from None
    if not rows:
        raise ImportProblem("The file has a header but no students.")
    return rows


async def check(session: AsyncSession, data: str, settings: Settings) -> list[Row]:
    """Every row with its status: new, exists (an account already uses the email), or error."""
    return await check_rows(session, read(data), settings)


async def check_rows(
    session: AsyncSession, raw: list[dict[str, str]], settings: Settings
) -> list[Row]:
    """Like `check`, for rows already read ({column: value}, plus "_line"). Adding one person
    from a form goes through here too, so it follows exactly the rules of a CSV row."""
    hostels = {_hostel_key(h.name): h for h in (await session.scalars(select(Hostel))).all()}
    domain = settings.allowed_email_domains[0] if settings.allowed_email_domains else None
    out: list[Row] = []
    for r in raw:
        line = int(r["_line"])
        fields = {k: v for k, v in r.items() if k not in ("_line", "hostel", "role") and v}
        hostel_name = r.get("hostel") or None
        role_text = re.sub(r"\s+", " ", r.get("role", "").strip().lower()) or "student"
        role = ROLES.get(role_text)
        try:
            parsed = _Row.model_validate(fields)
        except ValidationError as e:
            out.append(
                Row(
                    line,
                    r.get("student_id", ""),
                    r.get("name", ""),
                    r.get("email", ""),
                    hostel_name,
                    "error",
                    _first_error(e),
                    role=role or UserRole.STUDENT,
                )
            )
            continue
        by_id = f"{parsed.student_id}@{domain}" if domain and parsed.student_id else ""
        email = (parsed.email or by_id).lower()
        row = Row(
            line,
            parsed.student_id or "",
            parsed.name,
            email,
            hostel_name,
            "new",
            phone=parsed.phone,
            parent_name=parsed.parent_name,
            parent_phone=parsed.parent_phone,
            role=role or UserRole.STUDENT,
        )
        if role is None:
            row.status, row.error = (
                "error",
                "Role: use student, warden, head warden or admin (blank means student)",
            )
        elif role is UserRole.STUDENT and not parsed.student_id:
            row.status, row.error = "error", "Student ID: is missing"
        elif role is UserRole.WARDEN and not hostel_name:
            row.status, row.error = "error", "Hostel: a warden needs the hostel they look after"
        elif not email:
            row.status, row.error = "error", "Email: is missing"
        elif parsed.parent_phone and not parsed.parent_name:
            row.status, row.error = "error", "Parent's name: needed with the parent's number"
        elif parsed.parent_name and not parsed.parent_phone:
            row.status, row.error = "error", "Parent's number: needed with the parent's name"
        elif not email or not email_allowed(email, settings):
            row.status, row.error = "error", "Email: not a Graphic Era address"
        elif hostel_name:
            hostel = hostels.get(_hostel_key(hostel_name))
            if hostel is None:
                known = ", ".join(sorted(h.name for h in hostels.values())) or "none yet"
                row.status, row.error = "error", f"Hostel: no hostel named that (known: {known})"
            else:
                row.hostel, row.hostel_id = hostel.name, hostel.id
        out.append(row)

    seen: dict[str, int] = {}
    for row in out:
        if row.status != "error" and row.email in seen:
            row.status, row.error = "error", f"Email: same as line {seen[row.email]}"
        elif row.email:
            seen.setdefault(row.email, row.line)
    emails = [r.email for r in out if r.status == "new"]
    if emails:
        existing = set(
            (await session.scalars(select(User.email).where(User.email.in_(emails)))).all()
        )
        for row in out:
            if row.status == "new" and row.email in existing:
                row.status, row.error = "exists", "An account already uses this email"
    await session.commit()  # ends the read transaction
    return out


@dataclass
class Created:
    user_id: uuid.UUID
    email: str
    name: str
    token: str


async def save(
    session: AsyncSession, rows: list[Row], pepper: str, admin_id: uuid.UUID
) -> list[Created]:
    """Creates the "new" rows' students with no password and an invite link each, in one
    transaction (an email taken meanwhile is skipped). Returns what to email."""
    new = [r for r in rows if r.status == "new"]
    if not new:
        return []
    emails = [r.email for r in new]
    taken = set(
        (
            await session.scalars(
                select(User.email).where(User.email.in_(emails)).with_for_update()
            )
        ).all()
    )
    created: list[Created] = []
    for r in new:
        if r.email in taken:
            r.status, r.error = "exists", "An account already uses this email"
            continue
        student = r.role is UserRole.STUDENT
        user = User(
            role=r.role,
            name=r.name,
            email=r.email,
            password_hash=account_links.NO_PASSWORD,
            roll_no=r.student_id or None,
            # A student lives in the hostel; a warden looks after it (below); head wardens
            # and admins cover every hostel.
            hostel_id=r.hostel_id if student else None,
            phone=r.phone,
            emergency_name=r.parent_name,
            emergency_relation="Parent" if r.parent_name else None,
            emergency_phone=r.parent_phone,
        )
        session.add(user)
        await session.flush()
        if r.role is UserRole.WARDEN and r.hostel_id is not None:
            session.add(WardenHostel(user_id=user.id, hostel_id=r.hostel_id))
        token = await account_links.issue(
            session, user.id, LinkPurpose.INVITE, pepper, created_by=admin_id
        )
        created.append(Created(user.id, r.email, r.name, token))
    # A half-finished self sign-up for the same address would clash at verification.
    await session.execute(
        delete(PendingRegistration).where(
            func.lower(PendingRegistration.email).in_([c.email for c in created])
        )
    )
    await session.commit()
    return created


async def send_invites(
    sessionmaker: async_sessionmaker[AsyncSession],
    mailer: Mailer,
    created: list[Created],
    web_url: str,
    pepper: str,
) -> None:
    """Runs after the response: emails each link, a little apart. A failed email leaves the
    link unsent (sent_at empty); People shows it, and the admin can send it again."""
    async with sessionmaker() as session:
        for i, c in enumerate(created):
            if i:
                await asyncio.sleep(SEND_GAP_SECONDS)
            try:
                await account_links.send(
                    session,
                    mailer,
                    user_id=c.user_id,
                    to=c.email,
                    name=c.name,
                    purpose=LinkPurpose.INVITE,
                    token=c.token,
                    web_url=web_url,
                    pepper=pepper,
                )
            except account_links.EmailNotSent:
                continue
    logger.info("sent %d import invites", len(created))
