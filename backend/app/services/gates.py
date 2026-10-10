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
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CampusSettings, Gate, GateScan, Outing, ScanDirection, ScanResult, User
from app.schemas import GateScanIn, OutingCreateIn
from app.security.gate_codes import code_is_valid, hash_kiosk_token, parse_qr
from app.services import outings, rules

EARTH_RADIUS_M = 6_371_000
MAX_ACCURACY_M = 150  # worse than this, GPS cannot say which side of a gate you're on
ACCURACY_ALLOWANCE_CAP_M = 50  # count up to this much GPS error in the student's favour
REPLAY_WINDOW = timedelta(seconds=60)  # a second accepted scan this soon is a double scan


class ScanRejected(Exception):
    def __init__(self, result: ScanResult, message: str) -> None:
        super().__init__(message)
        self.result = result
        self.message = message


class AlreadyScanned(Exception):
    pass


@dataclass(frozen=True)
class ScanOutcome:
    direction: ScanDirection
    gate: Gate
    outing: Outing


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
    session: AsyncSession, user_id: uuid.UUID, body: GateScanIn, pepper: str
) -> ScanOutcome:
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

    if direction is ScanDirection.IN:
        outing = await outings.mark_return(session, user_id, gate_id=gate.id, commit=False)
        if outing is None:  # closed by a simultaneous request; treat as a double scan
            raise AlreadyScanned
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
            )
        except rules.Refused as e:  # at the gate, but not allowed out now: worth a log entry
            # (the rules refuse before check_out writes anything, so nothing to undo)
            raise await reject(gate, ScanResult.NOT_ALLOWED, e.message) from None
    await _record(session, user_id, gate, direction, ScanResult.ACCEPTED, body, outing.id)
    await session.commit()
    await session.refresh(outing)
    return ScanOutcome(direction, gate, outing)


async def gate_for_kiosk(session: AsyncSession, kiosk_token: str) -> Gate | None:
    return (
        await session.execute(
            select(Gate).where(Gate.kiosk_token_hash == hash_kiosk_token(kiosk_token))
        )
    ).scalar_one_or_none()
