"""Gate tap-in / tap-out (students) and the rotating QR feed (gate kiosks)."""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request, status
from fastapi.responses import JSONResponse

from app.api.deps import (
    CurrentUser,
    HubDep,
    LimiterDep,
    MailerDep,
    OutboxDep,
    SessionDep,
    SettingsDep,
    client_ip,
    enforce,
)
from app.api.outings import (
    release_unused,
    safe_return_ended,
    safe_return_slot,
    safe_return_started,
)
from app.models import Hostel, ScanDirection
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
    except rules.Refused:  # rules not set up: nobody can go out, so there's no return time
        return CampusOut()
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
            no_form_from=w.no_form_from,
        ),
    )


@router.post("/gates/scan")
async def scan(
    body: GateScanIn,
    me: CurrentUser,
    session: SessionDep,
    settings: SettingsDep,
    limiter: LimiterDep,
    hub: HubDep,
    mailer: MailerDep,
    tasks: BackgroundTasks,
    sender: OutboxDep,
) -> GateScanOut:
    """Tap out (no open outing) or tap in (open outing) by scanning the gate's QR."""
    await enforce(limiter, "scan:user", str(me.id), SCANS_PER_USER)
    slot = await safe_return_slot(body.safe_return, me, limiter, settings)
    try:
        outcome = await svc.scan(
            session,
            me.id,
            body,
            settings.code_pepper.get_secret_value(),
            start_safe_return=slot is not None,
            web_url=sender.web_url,
        )
    except svc.ScanRejected as e:
        await release_unused(limiter, slot, None)
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=e.message) from None
    except svc.StaleOuting as e:
        await release_unused(limiter, slot, None)
        left = e.left_at.astimezone(rules.IST)
        never_closed = f"Your outing from {left:%a} {left.day} {left:%b} was never closed."
        if not body.ask_if_stale:  # an older app shows `detail` as text
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail=f"{never_closed} Tap I'm back in the app, then scan again to go out.",
            ) from None
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "code": "stale_outing",
                "left_at": left.isoformat(),
                "message": f"{never_closed} Are you coming back in, or going out now?",
            },
        ) from None
    except svc.AlreadyScanned:
        await release_unused(limiter, slot, None)
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="You just scanned. Check Today to see your status."
        ) from None
    except outings.AlreadyOut:  # a parallel request opened an outing first
        await release_unused(limiter, slot, None)
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="You're already checked out."
        ) from None
    except BaseException:  # any other failure too (see check_out in app/api/outings.py)
        await release_unused(limiter, slot, None)
        raise
    # A tap-in starts nothing (the outing it closes may have a share of its own).
    started = outcome.outing if outcome.direction is ScanDirection.OUT else None
    await release_unused(limiter, slot, started)
    sender.send_now(outcome.alerts)
    # Ended first: going out again can close an earlier day's outing (and its share).
    await safe_return_ended(outcome.back, hub=hub, mailer=mailer, tasks=tasks)
    if outcome.direction is ScanDirection.OUT:
        await safe_return_started(outcome.outing, me, mailer=mailer, settings=settings, tasks=tasks)
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
    """What a gate kiosk shows right now. Authenticated by the kiosk's own device token.

    Every poll from a known kiosk counts as a sign of life (kiosk health on Admin, Gates),
    written at most once a minute. In quiet hours the answer is a 423 with `quiet` and
    `opens_at`: the kiosk shows when it opens and asks nothing more until then. An older kiosk
    page reads only `detail` and checks back every 30 seconds."""
    await enforce(limiter, "kiosk:ip", client_ip(request), KIOSK_PER_IP)
    gate = await svc.gate_for_kiosk(session, x_kiosk_token) if x_kiosk_token else None
    if gate is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Unknown kiosk")
    now = datetime.now(UTC)
    quiet = svc.quiet_hours(await svc.campus_settings(session))
    name = gate.name
    if svc.note_kiosk_seen(gate, now):
        await session.commit()
    if not gate.active:
        raise HTTPException(status.HTTP_423_LOCKED, detail=f"{name} is switched off")
    if quiet is not None and quiet.is_quiet(now):
        opens = quiet.opens_at(now)
        return JSONResponse(  # type: ignore[return-value]
            status_code=status.HTTP_423_LOCKED,
            content={
                "detail": f"{name} opens at {opens.astimezone(rules.IST):%H:%M}",
                "quiet": True,
                "opens_at": opens.isoformat(),
            },
        )
    window = window_at(now)
    code = gate_code(settings.code_pepper.get_secret_value(), gate.id, window)
    return KioskOut(
        gate_id=gate.id,
        gate_name=gate.name,
        qr=qr_payload(settings.web_url, gate.id, window, code),
        refresh_at=datetime.fromtimestamp(window_ends_at(window), UTC),
    )
