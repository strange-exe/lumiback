"""Admin area (wardens / security): the live register, gate scans, gates, settings, roles."""

import uuid
from datetime import UTC, date, datetime, time
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import AdminUser, SessionDep
from app.models import Gate, ScanResult, User, UserRole
from app.schemas import (
    AdminOuting,
    AdminOverview,
    AdminScanPage,
    CampusSettingsIO,
    GateCreated,
    GateIn,
    GateOut,
    GatePatch,
    RoleIn,
)
from app.schemas import (
    AdminUser as AdminUserOut,
)
from app.security.gate_codes import new_kiosk_token
from app.services import admin as svc
from app.services.gates import campus_settings

router = APIRouter(prefix="/admin", tags=["admin"])

NOT_FOUND = HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found")
NAME_TAKEN = HTTPException(status.HTTP_409_CONFLICT, detail="A gate with that name already exists")


@router.get("/overview")
async def overview(_: AdminUser, session: SessionDep) -> AdminOverview:
    return await svc.overview(session)


@router.get("/outings")
async def open_outings(
    _: AdminUser,
    session: SessionDep,
    state: Literal["all", "out", "overdue"] = "all",
) -> list[AdminOuting]:
    return await svc.open_outings(session, state)


@router.get("/late-today")
async def late_today(_: AdminUser, session: SessionDep) -> list[AdminOuting]:
    """Tonight's latecomers: back after their return time, or still out past it."""
    return await svc.late_today(session)


@router.get("/outings.csv")
async def outings_csv(
    _: AdminUser,
    session: SessionDep,
    start: Annotated[date, Query(alias="from")],
    end: Annotated[date, Query(alias="to")],
) -> Response:
    if end < start or (end - start).days >= svc.MAX_EXPORT_DAYS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Choose a range of at most {svc.MAX_EXPORT_DAYS} days",
        )
    body = await svc.outings_csv(session, start, end)
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="outings-{start}-to-{end}.csv"'},
    )


@router.get("/scans")
async def scans(
    _: AdminUser,
    session: SessionDep,
    before: int | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    gate_id: uuid.UUID | None = None,
    result: ScanResult | None = None,
) -> AdminScanPage:
    return await svc.scans(session, before=before, limit=limit, gate_id=gate_id, result=result)


# ---------- gates ----------


@router.get("/gates")
async def list_gates(_: AdminUser, session: SessionDep) -> list[GateOut]:
    gates = await session.scalars(select(Gate).order_by(Gate.name))
    return [GateOut.model_validate(g) for g in gates]


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
    return GateCreated(gate=GateOut.model_validate(gate), kiosk_token=token)


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
    return GateOut.model_validate(gate)


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
    return GateCreated(gate=GateOut.model_validate(gate), kiosk_token=token)


# ---------- settings ----------


@router.get("/settings")
async def get_settings(_: AdminUser, session: SessionDep) -> CampusSettingsIO:
    row = await campus_settings(session)
    await session.commit()
    return CampusSettingsIO(
        curfew=row.curfew.strftime("%H:%M"), scan_retention_days=row.scan_retention_days
    )


@router.put("/settings")
async def put_settings(
    body: CampusSettingsIO, me: AdminUser, session: SessionDep
) -> CampusSettingsIO:
    row = await campus_settings(session)
    if body.curfew is not None:  # older admin pages still send it
        hours, minutes = (int(x) for x in body.curfew.split(":"))
        row.curfew = time(hours, minutes)
    row.scan_retention_days = body.scan_retention_days
    row.updated_at = datetime.now(UTC)
    svc.audit(session, me, "settings", f"keep scans {body.scan_retention_days} d")
    await session.commit()
    return CampusSettingsIO(
        curfew=row.curfew.strftime("%H:%M"), scan_retention_days=row.scan_retention_days
    )


# ---------- people ----------


@router.get("/users")
async def search_users(
    _: AdminUser, session: SessionDep, q: Annotated[str, Query(min_length=2, max_length=100)]
) -> list[AdminUserOut]:
    return await svc.search_users(session, q)


@router.post("/users/{user_id}/role")
async def set_role(
    user_id: uuid.UUID, body: RoleIn, me: AdminUser, session: SessionDep
) -> AdminUserOut:
    target = await session.get(User, user_id)
    if target is None or target.email_verified_at is None:
        raise NOT_FOUND
    try:
        await svc.set_role(session, me, target, UserRole(body.role))
    except svc.LastAdmin:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="Make someone else an admin first"
        ) from None
    return AdminUserOut(
        id=target.id,
        name=target.name,
        email=target.email,
        roll_no=target.roll_no,
        role=target.role.value,
    )
