"""Error reports from the website and the app (owner, 2026-11-07: our own endpoint, kept 30
days, a daily digest; no third-party service).

Scrubbed before anything is stored: an error message can quote whatever was on screen or in a
URL. `scrub` replaces, in this order: JWTs and bearer tokens, `key=value` secrets, query
strings and fragments, email addresses, ids (UUIDs), coordinates, the signed-in person's own
name, email, roll number and phone (and their emergency contact's), roll numbers, phone
numbers, long numbers, long hex and base64 strings. It errs on the side of removing too much.

Reports of the same error are one group (one row): the fingerprint is the scrubbed message
and top stack frame with numbers left out, so "after 3012 ms" and "after 4100 ms", or one
build's line numbers and the next's, count together. The row keeps the latest report as its
sample, a count, and when the error was first and last seen.
"""

import hashlib
import re
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.email import Email
from app.models import AlertOutbox, ErrorReport, OutboxMode, User
from app.schemas import ErrorGroup, ErrorReportIn
from app.services import outbox
from app.services.rules import ist_date

KEEP = timedelta(days=30)  # after the error was last seen (the privacy page says so)
# New groups stop being added past this many (reports of known ones still count): spraying
# made-up errors from many addresses can't fill the database.
MAX_GROUPS = 2000
DIGEST_KIND = "error_digest"
DIGEST_MAX_GROUPS = 25  # the most an email lists; the developer page has the rest
DIGEST_WINDOW = timedelta(days=1)  # without an earlier digest to start from

_HEX = r"0-9a-fA-F"
# (pattern, replacement), applied in order. Every rule must stay linear on hostile input (a
# report is anyone's to send): a rule whose first part can repeat starts only where that part
# can't continue a run to its left (the lookbehinds below), so a long run without the
# separator it waits for is scanned once, not once from every character.
_RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"(?<![\w-])eyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]*"), "[token]"),
    (re.compile(r"(?i)\bbearer\s+[\w.~+/=-]+"), "Bearer [token]"),
    # A query string or a fragment that carries values: everything after the ? or #.
    (re.compile(r"\?[\w%.\[\]-]*=[^\s\"'<>)|]*"), "?[query]"),
    (re.compile(r"#[\w%.\[\]-]*=[^\s\"'<>)|]*"), "#[fragment]"),
    (
        re.compile(
            r"(?i)\b(access_token|refresh_token|id_token|token|api[_-]?key|secret|password|"
            r"passwd|pwd|authorization|cookie|session|otp|code|pin)\b([\"']?\s*[:=]\s*[\"']?)"
            r"[^\s\"'&,;)]+"
        ),
        r"\1\2[secret]",
    ),
    (re.compile(r"(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+"), "[email]"),
    (
        re.compile(rf"\b[{_HEX}]{{8}}-[{_HEX}]{{4}}-[{_HEX}]{{4}}-[{_HEX}]{{4}}-[{_HEX}]{{12}}\b"),
        "[id]",
    ),
    (re.compile(r"-?\b\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}\b"), "[location]"),
    (
        re.compile(r"(?i)\b(lat|lng|lon|latitude|longitude)\b([\"']?\s*[:=]\s*)-?\d+(?:\.\d+)?"),
        r"\1\2[location]",
    ),
]
# After the signed-in person's own details:
_LATER: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\b\d{2}[A-Za-z]{2,6}\d{2,5}\b"), "[roll]"),  # 22BTCS0042, 22CS101
    (re.compile(r"(?<![\w+])(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}\b"), "[phone]"),
    (re.compile(r"(?<!\w)\+\d[\d\s-]{7,16}\d\b"), "[phone]"),
    (re.compile(r"\b\d{10,}\b"), "[number]"),
    (re.compile(rf"\b(?=[{_HEX}]*[a-fA-F])(?=[{_HEX}]*\d)[{_HEX}]{{16,}}\b"), "[secret]"),
]
_BASE64 = re.compile(r"(?<![\w+-])[A-Za-z0-9+_-]{24,}={0,2}")


def _looks_random(run: str) -> bool:
    """A long run of letters and digits in both cases: a key or token, not a word."""
    return (
        any(c.isdigit() for c in run)
        and any(c.islower() for c in run)
        and any(c.isupper() for c in run)
    )


@dataclass(frozen=True)
class Personal:
    """What the signed-in person's report must never keep, besides the general rules."""

    names: tuple[str, ...] = ()  # full names and their words
    exact: tuple[tuple[str, str], ...] = ()  # (text, placeholder): roll number, phone

    @classmethod
    def of(cls, user: User | None) -> "Personal":
        if user is None:
            return cls()
        names: list[str] = []
        for full in (user.name, user.emergency_name):
            if full:
                names.append(full.strip())
                names.extend(w for w in re.split(r"[\s.,'-]+", full) if len(w) >= 2)
        exact = [
            (value.strip(), placeholder)
            for value, placeholder in (
                (user.roll_no, "[roll]"),
                (user.phone, "[phone]"),
                (user.emergency_phone, "[phone]"),
            )
            if value and len(value.strip()) >= 3
        ]
        # Longest first, so a full name goes before its words.
        return cls(
            tuple(sorted(set(names), key=len, reverse=True)),
            tuple(sorted(exact, key=lambda e: len(e[0]), reverse=True)),
        )


def scrub(value: str | None, personal: Personal = Personal()) -> str | None:  # noqa: B008
    """Known limit: the names, roll number and phone removed as such are only the REPORTER's
    own (and their emergency contact's). Another person's name on screen (a warden reading a
    student's record, a friend in a follow list) has no pattern to match and stays unless a
    general rule catches it; their email, phone, roll number and ids still go by those rules.
    So a stored report may still name someone else: only developers read them, and they go
    30 days after they were last seen."""
    if not value:
        return value
    for pattern, replacement in _RULES:
        value = pattern.sub(replacement, value)
    for text, placeholder in personal.exact:
        value = re.sub(re.escape(text), placeholder, value, flags=re.IGNORECASE)
    for name in personal.names:
        value = re.sub(rf"(?<!\w){re.escape(name)}(?!\w)", "[name]", value, flags=re.IGNORECASE)
    for pattern, replacement in _LATER:
        value = pattern.sub(replacement, value)
    return _BASE64.sub(lambda m: "[secret]" if _looks_random(m.group()) else m.group(), value)


def clean_route(route: str | None, personal: Personal) -> str | None:
    """The page's path only: a query string or fragment is never kept."""
    if not route:
        return None
    path = re.split(r"[?#]", route, maxsplit=1)[0]
    return scrub(path, personal)[:300] or None


_FRAME = re.compile(r"^\s*(at\s|\S*@\S)")


def top_frame(stack: str | None) -> str | None:
    """The first stack frame: V8 and Hermes ("at f (file:1:2)") and Firefox or Safari
    ("f@file:1:2"). None for a stack without one."""
    for line in (stack or "").splitlines():
        if _FRAME.match(line):
            return line.strip()[:500]
    return None


def fingerprint(message: str, frame: str | None) -> bytes:
    """The group's key: numbers left out, so counts, ids and line numbers don't split it."""
    key = re.sub(r"\d+", "0", f"{message}\n{frame or ''}")
    return hashlib.sha256(key.encode()).digest()


async def record(session: AsyncSession, report: ErrorReportIn, user: User | None) -> bool:
    """Scrubs and stores one report (the caller commits). False when it was a new group past
    MAX_GROUPS, and so dropped."""
    personal = Personal.of(user)
    message = (scrub(report.message, personal) or "")[:500]
    stack = scrub(report.stack, personal) or None
    frame = top_frame(stack)
    key = fingerprint(message, frame)
    values = {
        "message": message,
        "top_frame": frame,
        "stack": stack,
        "route": clean_route(report.route, personal),
        "platform": report.platform,
        "app_version": report.app_version,
        "last_user_id": user.id if user is not None else None,
    }
    known = await session.scalar(select(ErrorReport.id).where(ErrorReport.fingerprint == key))
    if known is None and (await session.scalar(select(func.count(ErrorReport.id)))) >= MAX_GROUPS:
        return False
    stmt = insert(ErrorReport).values(fingerprint=key, **values)
    await session.execute(
        stmt.on_conflict_do_update(
            index_elements=[ErrorReport.fingerprint],
            set_={
                **{name: stmt.excluded[name] for name in values},
                "count": ErrorReport.count + 1,
                "last_seen_at": func.now(),
            },
        )
    )
    return True


async def recent(session: AsyncSession, limit: int) -> list[ErrorGroup]:
    rows = await session.scalars(
        select(ErrorReport)
        .order_by(ErrorReport.last_seen_at.desc(), ErrorReport.id.desc())
        .limit(limit)
    )
    return [
        ErrorGroup(
            id=r.id,
            message=r.message,
            top_frame=r.top_frame,
            stack=r.stack,
            route=r.route,
            platform=r.platform,
            app_version=r.app_version,
            count=r.count,
            first_seen_at=r.first_seen_at,
            last_seen_at=r.last_seen_at,
            signed_in=r.last_user_id is not None,
        )
        for r in rows
    ]


async def delete_old(session: AsyncSession, now: datetime) -> int:
    result = await session.execute(delete(ErrorReport).where(ErrorReport.last_seen_at < now - KEEP))
    return result.rowcount


def _times(n: int) -> str:
    return "once" if n == 1 else f"{n} times"


_LINK = re.compile(r"(?i)\bhttp(s?)://([^\s/?#\"'<>]*)")
_WWW = re.compile(r"(?i)(?<![\w.-])www\.([\w-]+(?:\.[\w-]+)*)")


def defang(text: str) -> str:
    """Links in a report can't be clicked in the digest: anyone can send a report, so its
    text may carry a phishing link. `https://a.example/x` becomes `hxxps://a[.]example/x`, and
    a bare `www.a.example` becomes `www[.]a[.]example`; other dots (`x.y is not a function`)
    stay."""
    text = _LINK.sub(lambda m: f"hxxp{m.group(1)}://{m.group(2).replace('.', '[.]')}", text)
    return _WWW.sub(lambda m: "www[.]" + m.group(1).replace(".", "[.]"), text)


async def queue_digest(
    session: AsyncSession, now: datetime, to: str | None, web_url: str
) -> int | None:
    """The day's digest (the caller commits; the outbox sends it): the errors seen since the
    last digest, however long ago (or the last day, before the first one), at most once per IST
    day, and only when there are some. Nothing without an address. Returns the outbox id, or
    None."""
    if not to:
        return None
    key = f"{DIGEST_KIND}:{ist_date(now).isoformat()}"
    if await session.scalar(select(AlertOutbox.id).where(AlertOutbox.key == key)) is not None:
        return None
    last = await session.scalar(
        select(func.max(AlertOutbox.created_at)).where(AlertOutbox.kind == DIGEST_KIND)
    )
    # From the last digest even when it is more than a day old (the API asleep, or days
    # without errors): starting a day back would skip whatever came in between. Reports
    # older than KEEP are gone by then anyway.
    since = last if last is not None else now - DIGEST_WINDOW
    seen = ErrorReport.last_seen_at >= since
    total = await session.scalar(select(func.count(ErrorReport.id)).where(seen)) or 0
    if total == 0:
        return None
    groups = await session.scalars(
        select(ErrorReport)
        .where(seen)
        .order_by(ErrorReport.count.desc(), ErrorReport.last_seen_at.desc())
        .limit(DIGEST_MAX_GROUPS)
    )
    lines = [
        f"{total} {'error was' if total == 1 else 'errors were'} seen on Lumiback since the last "
        "digest.",
        "These are unverified reports: anyone's browser or app can send one, so the text below "
        "may be made up. Treat it as a lead, not a fact. It was scrubbed (no names, addresses, "
        "numbers or tokens) and its links are disabled (hxxps, [.]); don't open them.",
        "",
    ]
    for g in groups:
        lines += [
            f"- {defang(g.message[:200])}",
            f"  {g.platform}, version {g.app_version or 'unknown'}, "
            f"page {defang(g.route) if g.route else 'unknown'}",
            f"  Seen {_times(g.count)} in all. First seen {g.first_seen_at:%Y-%m-%d %H:%M} UTC, "
            f"last seen {g.last_seen_at:%Y-%m-%d %H:%M} UTC.",
            "",
        ]
    if total > DIGEST_MAX_GROUPS:
        lines += [f"And {total - DIGEST_MAX_GROUPS} more.", ""]
    lines.append(f"Every error, with its stack: {web_url}/admin/errors")
    email = Email(
        to=to,
        subject=f"Lumiback: {total} {'error' if total == 1 else 'errors'} since the last digest",
        body="\n".join(lines),
    )
    return await outbox.enqueue(
        session, key=key, kind=DIGEST_KIND, mode=OutboxMode.EMAIL, email=email
    )
