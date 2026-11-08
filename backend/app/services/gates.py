"""Gate tap-in / tap-out.

A scan proves two things before it changes anything:
1. the code is a current rotating code for an active gate (see app/security/gate_codes.py), and
2. the phone is at that gate: GPS within the gate radius (plus some allowance for GPS error),
   accuracy good enough to tell, and not a mock-location provider.

Direction comes from the student's state: no open outing -> tap out, open outing -> tap in.
Every attempt is recorded in gate_scans with its result and the distance from the gate (never
the coordinates), so admins can see rejected attempts too.
"""

import math
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    CampusSettings,
    Gate,
    GateScan,
    InVia,
    Outing,
    ScanDirection,
    ScanResult,
    User,
)
from app.schemas import GateScanIn, OutingCreateIn
from app.security.gate_codes import code_is_valid, hash_kiosk_token, parse_qr
from app.services import outings, rules
from app.services.safe_return import Back

EARTH_RADIUS_M = 6_371_000
MAX_ACCURACY_M = 150  # worse than this, GPS cannot say which side of a gate you're on
ACCURACY_ALLOWANCE_CAP_M = 50  # count up to this much GPS error in the student's favour
REPLAY_WINDOW = timedelta(seconds=60)  # a second accepted scan this soon is a double scan
# When an outing left open from an earlier day stops counting as a late return (see
# outing_is_stale).
STALE_PAST_DUE = timedelta(hours=6)
STALE_AFTER_LEAVING = timedelta(hours=18)


class ScanRejected(Exception):
    def __init__(self, result: ScanResult, message: str) -> None:
        super().__init__(message)
        self.result = result
        self.message = message


class AlreadyScanned(Exception):
    pass


class StaleOuting(Exception):
    """An outing from an earlier day is still open: ask whether they're coming in or going
    out, instead of counting this scan as the return the gate never saw."""

    def __init__(self, left_at: datetime) -> None:
        super().__init__("stale outing")
        self.left_at = left_at


@dataclass(frozen=True)
class ScanOutcome:
    direction: ScanDirection
    gate: Gate
    outing: Outing
    # A safe-return share this scan ended: a tap-in's, or (going out again) the share of the
    # earlier day's outing closed as an unrecorded return.
    back: Back | None = None
    alerts: list[int] = field(default_factory=list)  # a tap-in's followers told (send them)


def distance_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance (haversine). Plenty precise at campus scale."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def gps_problem(gate: Gate, body: GateScanIn) -> tuple[ScanResult, str] | None:
    if body.mocked:
        return ScanResult.MOCK_GPS, "Turn off mock location apps, then scan again."
    if body.accuracy_m > MAX_ACCURACY_M:
        return (
            ScanResult.WEAK_GPS,
            "Your location isn't precise enough. Step outside and try again.",
        )
    away = distance_m(body.lat, body.lng, gate.lat, gate.lng)
    if away > gate.radius_m + min(body.accuracy_m, ACCURACY_ALLOWANCE_CAP_M):
        return (
            ScanResult.TOO_FAR,
            f"You're about {round(away)} m from {gate.name}. Scan at the gate.",
        )
    return None


def outing_is_stale(left_at: datetime, due: datetime, now: datetime) -> bool:
    """An open outing from an earlier day that the student probably came back from long ago
    (they forgot to tap in), so a scan now is more likely them going out again.

    A new IST date alone isn't enough: someone due at 9:30 PM who taps in at 00:20 is simply
    late, and that gate-verified return must count. So it's stale only once it's also well past
    the due time (STALE_PAST_DUE: a night's lateness is hours, the next morning's exit is
    more), or long after leaving (STALE_AFTER_LEAVING: the rules cap an outing at 12 h)."""
    if rules.ist_date(left_at) >= rules.ist_date(now):
        return False
    return now - due >= STALE_PAST_DUE or now - left_at >= STALE_AFTER_LEAVING


IST = timedelta(hours=5, minutes=30)  # the campus clock (no daylight saving)
# Kiosk health: a tablet asks for a code every 20 s (30 s while its gate is off), but its last
# seen time is written at most this often, so a kiosk isn't a database write per poll.
KIOSK_SEEN_EVERY = timedelta(minutes=1)
# No poll for this long (outside quiet hours) and the admin is warned the tablet looks down.
KIOSK_STALE_AFTER = timedelta(minutes=5)


@dataclass(frozen=True)
class QuietHours:
    """Kiosk quiet hours on the campus clock: from `start` up to (not including) `end`. The
    window crosses midnight when `end` is earlier than `start` (23:00 to 05:00)."""

    start: time
    end: time

    def is_quiet(self, now: datetime) -> bool:
        t = _ist(now).time()
        if self.start < self.end:
            return self.start <= t < self.end
        return t >= self.start or t < self.end

    def opens_at(self, now: datetime) -> datetime:
        """The next time the kiosks open (the end of the window) after `now`."""
        local = _ist(now)
        opens = datetime.combine(local.date(), self.end)
        if opens <= local:
            opens += timedelta(days=1)
        return _utc(opens)

    def last_opened(self, now: datetime) -> datetime:
        """When the kiosks last opened, at or before `now`."""
        local = _ist(now)
        opened = datetime.combine(local.date(), self.end)
        if opened > local:
            opened -= timedelta(days=1)
        return _utc(opened)


def _ist(now: datetime) -> datetime:
    """`now` as a naive wall-clock time on the campus clock."""
    return (now.astimezone(UTC) + IST).replace(tzinfo=None)


def _utc(local: datetime) -> datetime:
    return (local - IST).replace(tzinfo=UTC)


def quiet_hours(row: CampusSettings) -> QuietHours | None:
    """None: quiet hours are off (the default)."""
    if row.kiosk_quiet_from is None or row.kiosk_quiet_until is None:
        return None
    return QuietHours(row.kiosk_quiet_from, row.kiosk_quiet_until)


def kiosk_health(gate: Gate, quiet: QuietHours | None, now: datetime) -> str:
    """quiet: inside quiet hours (tablets are meant to be idle). never: no tablet has asked for
    a code since health was recorded. ok: asked recently, or the kiosks only just opened.
    stale: silent too long; the tablet may be off, asleep or offline."""
    if quiet is not None and quiet.is_quiet(now):
        return "quiet"
    if gate.kiosk_seen_at is None:
        return "never"
    if now - gate.kiosk_seen_at <= KIOSK_STALE_AFTER:
        return "ok"
    if quiet is not None and now - quiet.last_opened(now) <= KIOSK_STALE_AFTER:
        return "ok"  # opened moments ago: the tablet wakes up on its own
    return "stale"


def note_kiosk_seen(gate: Gate, now: datetime) -> bool:
    """Records a kiosk poll on `gate` unless one was recorded in the last minute. True when it
    changed (the caller commits)."""
    if gate.kiosk_seen_at is not None and now - gate.kiosk_seen_at < KIOSK_SEEN_EVERY:
        return False
    gate.kiosk_seen_at = now
    return True


async def campus_settings(session: AsyncSession) -> CampusSettings:
    row = await session.get(CampusSettings, 1)
    if row is None:  # created by the migration; recreate if someone deleted it
        row = CampusSettings(id=1)
        session.add(row)
        await session.flush()
        await session.refresh(row)
    return row


async def _record(
    session: AsyncSession,
    user_id: uuid.UUID,
    gate: Gate | None,
    direction: ScanDirection,
    result: ScanResult,
    body: GateScanIn,
    outing_id: uuid.UUID | None = None,
) -> None:
    session.add(
        GateScan(
            user_id=user_id,
            gate_id=gate.id if gate else None,
            direction=direction,
            result=result,
            distance_m=(
                round(distance_m(body.lat, body.lng, gate.lat, gate.lng), 1) if gate else None
            ),
            accuracy_m=round(body.accuracy_m, 1),
            outing_id=outing_id,
        )
    )


async def scan(
    session: AsyncSession,
    user_id: uuid.UUID,
    body: GateScanIn,
    pepper: str,
    *,
    start_safe_return: bool = False,
    web_url: str | None = None,
) -> ScanOutcome:
    """`start_safe_return`: on a tap-out, start safe return (the caller checked its limits).
    `web_url`: on a tap-in, tell the student's followers they're back (outings.mark_return)."""
    now = datetime.now(UTC)
    open_outing = await outings.current(session, user_id)
    direction = ScanDirection.IN if open_outing else ScanDirection.OUT

    async def reject(gate: Gate | None, result: ScanResult, message: str) -> ScanRejected:
        await _record(session, user_id, gate, direction, result, body)
        await session.commit()
        return ScanRejected(result, message)

    parsed = parse_qr(body.qr)
    gate = await session.get(Gate, parsed[0]) if parsed else None
    if parsed is None or gate is None or not code_is_valid(pepper, *parsed, now):
        raise await reject(
            gate, ScanResult.BAD_CODE, "That code isn't valid. Scan the gate screen again."
        )
    if not gate.active:
        raise await reject(gate, ScanResult.GATE_OFF, f"{gate.name} isn't taking scans right now.")
    if problem := gps_problem(gate, body):
        raise await reject(gate, *problem)

    last = (
        await session.execute(
            select(GateScan.scanned_at)
            .where(GateScan.user_id == user_id, GateScan.result == ScanResult.ACCEPTED)
            .order_by(GateScan.scanned_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if last is not None and now - last < REPLAY_WINDOW:
        raise AlreadyScanned  # nothing recorded: the earlier scan already did the work

    back = None
    if open_outing is not None and outing_is_stale(
        open_outing.left_at, open_outing.expected_return_at, now
    ):
        # Left on an earlier day and never tapped in: probably back long ago. Counting this
        # scan as the return would mark them in while they walk out. Ask (nothing recorded).
        if body.intent is None:
            raise StaleOuting(open_outing.left_at)
        if body.intent == "out":
            closed = await outings.mark_return(
                session, user_id, pepper=pepper, commit=False, via=InVia.UNRECORDED
            )
            if closed is None:  # closed by a simultaneous request; treat as a double scan
                raise AlreadyScanned
            back = closed.back
            direction = ScanDirection.OUT

    told: list[int] = []
    if direction is ScanDirection.IN:
        returned = await outings.mark_return(
            session, user_id, pepper=pepper, gate_id=gate.id, commit=False, web_url=web_url
        )
        if returned is None:  # closed by a simultaneous request; treat as a double scan
            raise AlreadyScanned
        outing, back, told = returned.outing, returned.back, returned.alerts
    else:
        student = await session.get(User, user_id)
        assert student is not None  # the caller is signed in as this user
        try:
            outing = await outings.check_out(
                session,
                student,
                OutingCreateIn(destination=body.destination),
                gate_id=gate.id,
                commit=False,
                safe_return_pepper=pepper if start_safe_return else None,
            )
        except rules.Refused as e:  # at the gate, but not allowed out now: worth a log entry
            # The rules refuse before check_out writes anything, but an earlier day's outing
            # closed above (going out again) must stay open: undo that, keep only the log.
            await session.rollback()
            await session.refresh(gate)  # the rollback expired it; the log entry reads it
            raise await reject(gate, ScanResult.NOT_ALLOWED, e.message) from None
    await _record(session, user_id, gate, direction, ScanResult.ACCEPTED, body, outing.id)
    await session.commit()
    await session.refresh(outing)
    return ScanOutcome(direction, gate, outing, back, told)


async def used_gate_ids(session: AsyncSession, gate_id: uuid.UUID | None = None) -> set[uuid.UUID]:
    """Gates some scan or outing names (all of them, or just `gate_id`). A used gate stays for
    the records: removing it would blank the gate on those rows."""
    named = (
        select(GateScan.gate_id.label("id"))
        .union(select(Outing.out_gate_id), select(Outing.in_gate_id))
        .subquery()
    )
    query = select(named.c.id).where(named.c.id.is_not(None))
    if gate_id is not None:
        query = query.where(named.c.id == gate_id)
    return set(await session.scalars(query))


async def gate_for_kiosk(session: AsyncSession, kiosk_token: str) -> Gate | None:
    return (
        await session.execute(
            select(Gate).where(Gate.kiosk_token_hash == hash_kiosk_token(kiosk_token))
        )
    ).scalar_one_or_none()
