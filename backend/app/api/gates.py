"""Gate tap-in / tap-out (students) and the rotating QR feed (gate kiosks)."""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Request, status

from app.api.deps import CurrentUser, LimiterDep, SessionDep, SettingsDep, client_ip, enforce
from app.models import Hostel
from app.schemas import CampusOut, GateScanIn, GateScanOut, KioskOut, TodayRulesOut
from app.security.gate_codes import gate_code, qr_payload, window_at, window_ends_at
from app.security.rate_limit import Limit
from app.services import gates as svc
from app.services import outings, rules

router = APIRouter(tags=["gates"])

SCANS_PER_USER = Limit(max_hits=30, window_seconds=600)
# A kiosk refreshes every few seconds; this only stops someone hammering the endpoint.
KIOSK_PER_IP = Limit(max_hits=120, window_seconds=60)


@router.get("/campus")
async def campus(me: CurrentUser, session: SessionDep) -> CampusOut:
    """Today's outing rules for this student (their hostel's rule set, or the campus default)."""
    now = datetime.now(UTC)
    try:
        w = await rules.today_window(session, me, now)
    except rules.Refused:  # rules not set up: fall back to the old single curfew
        curfew = (await svc.campus_settings(session)).curfew
        return CampusOut(curfew=curfew.strftime("%H:%M"), curfew_at=svc.curfew_today(curfew, now))
    hostel = await session.get(Hostel, me.hostel_id) if me.hostel_id else None
    return CampusOut(
        curfew=w.return_by.astimezone(rules.IST).strftime("%H:%M"),
        curfew_at=w.return_by,
        today=TodayRulesOut(
            day=w.day,
            day_type=w.day_type.value,
            label=w.label,
            rule_set=w.rule_set,
            hostel=hostel.name if hostel else None,
            opens_at=w.opens,
            return_by=w.return_by,
            max_minutes=w.max_minutes,
            needs_form=w.needs_form,
        ),
    )


@router.post("/gates/scan")
async def scan(
    body: GateScanIn,
    me: CurrentUser,
    session: SessionDep,
    settings: SettingsDep,
    limiter: LimiterDep,
) -> GateScanOut:
    """Tap out (no open outing) or tap in (open outing) by scanning the gate's QR."""
    await enforce(limiter, "scan:user", str(me.id), SCANS_PER_USER)
    try:
        outcome = await svc.scan(session, me.id, body, settings.code_pepper.get_secret_value())
    except svc.ScanRejected as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=e.message) from None
    except svc.AlreadyScanned:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="You just scanned. Check Today to see your status."
        ) from None
    except outings.AlreadyOut:  # a parallel request opened an outing first
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="You're already checked out."
        ) from None
    return GateScanOut(
        direction=outcome.direction.value,
        gate=outcome.gate.name,
        outing=outings.to_out(outcome.outing, datetime.now(UTC)),
    )


@router.get("/kiosk/qr")
async def kiosk_qr(
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
    limiter: LimiterDep,
    x_kiosk_token: Annotated[str | None, Header()] = None,
) -> KioskOut:
    """What a gate kiosk shows right now. Authenticated by the kiosk's own device token."""
    await enforce(limiter, "kiosk:ip", client_ip(request), KIOSK_PER_IP)
    gate = await svc.gate_for_kiosk(session, x_kiosk_token) if x_kiosk_token else None
    if gate is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Unknown kiosk")
    if not gate.active:
        raise HTTPException(status.HTTP_423_LOCKED, detail=f"{gate.name} is switched off")
    now = datetime.now(UTC)
    window = window_at(now)
    code = gate_code(settings.code_pepper.get_secret_value(), gate.id, window)
    return KioskOut(
        gate_id=gate.id,
        gate_name=gate.name,
        qr=qr_payload(settings.web_url, gate.id, window, code),
        refresh_at=datetime.fromtimestamp(window_ends_at(window), UTC),
    )
