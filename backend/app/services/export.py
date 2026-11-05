"""Download my data: everything Lumiback keeps about the signed-in person, as JSON.

Only their own records, and only what they can already see in the app about other people: the
names of their share's viewers (as in the viewer history), the gate names, their hostel's name.
Never staff user ids, other people's emails, or anything secret (password hash, refresh tokens,
push tokens, guest tokens, code hashes).
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models import (
    AccessLog,
    Contact,
    Escalation,
    Gate,
    GateScan,
    Hostel,
    Location,
    Outing,
    OutingRequest,
    PushToken,
    ShareSession,
    ShareViewer,
    User,
    ViewerStatus,
)

FORMAT_VERSION = 1


def _viewer_name(viewer: ShareViewer | None, user_name: str | None, admin_name: str | None) -> str:
    """The same names the sharer sees in their viewer history."""
    if viewer is None:
        return f"{admin_name or 'An admin'} (hostel office)"
    if viewer.viewer_user_id:
        return user_name or "Deleted account"
    return viewer.guest_label or "Guest"


async def _gate_names(session: AsyncSession) -> dict[uuid.UUID, str]:
    return {i: n for i, n in (await session.execute(select(Gate.id, Gate.name))).all()}


async def _hostel_names(session: AsyncSession) -> dict[uuid.UUID, str]:
    return {i: n for i, n in (await session.execute(select(Hostel.id, Hostel.name))).all()}


async def export_user(session: AsyncSession, user: User) -> dict[str, Any]:
    gates = await _gate_names(session)
    hostels = await _hostel_names(session)

    def gate(gate_id: uuid.UUID | None) -> str | None:
        return gates.get(gate_id) if gate_id else None

    def hostel(hostel_id: uuid.UUID | None) -> str | None:
        return hostels.get(hostel_id) if hostel_id else None

    escalations = {
        e.outing_id: e
        for e in (
            await session.scalars(
                select(Escalation)
                .join(Outing, Outing.id == Escalation.outing_id)
                .where(Outing.student_id == user.id)
            )
        )
    }
    outings = [
        {
            "id": o.id,
            "left_at": o.left_at,
            "expected_return_at": o.expected_return_at,
            "returned_at": o.returned_at,
            "destination": o.destination,
            "purpose": o.purpose,
            "hostel": hostel(o.hostel_id),
            "out_via": o.out_via.value,
            "out_gate": gate(o.out_gate_id),
            "in_via": o.in_via.value if o.in_via else None,
            "in_gate": gate(o.in_gate_id),
            "request_id": o.request_id,
            # Kept only while their emergency contact follows this outing (safe return).
            "safe_return_email": o.safe_return_email,
            "late_alert_sent_at": o.overdue_notified_at,
            "late_reply": o.late_reply.value if o.late_reply else None,
            "late_replied_at": o.late_replied_at,
            # The fact of a follow-up and when; the office's own note stays with the office.
            "escalated_at": escalations[o.id].created_at if o.id in escalations else None,
            "escalation_resolved_at": (
                escalations[o.id].resolved_at if o.id in escalations else None
            ),
        }
        for o in await session.scalars(
            select(Outing).where(Outing.student_id == user.id).order_by(Outing.left_at)
        )
    ]
    requests = [
        {
            "id": r.id,
            "day": r.day,
            "purpose": r.purpose,
            "phone": r.phone,
            "emergency_name": r.emergency_name,
            "emergency_relation": r.emergency_relation,
            "emergency_phone": r.emergency_phone,
            "requested_minutes": r.requested_minutes,
            "status": r.status.value,
            "decided_at": r.decided_at,
            "note": r.note,
            "created_at": r.created_at,
        }
        for r in await session.scalars(
            select(OutingRequest)
            .where(OutingRequest.student_id == user.id)
            .order_by(OutingRequest.created_at)
        )
    ]

    shares = list(
        await session.scalars(
            select(ShareSession)
            .where(ShareSession.sharer_id == user.id)
            .order_by(ShareSession.created_at)
        )
    )
    share_ids = [s.id for s in shares]
    viewer_user = aliased(User)
    viewers: dict[uuid.UUID, list[dict[str, Any]]] = {i: [] for i in share_ids}
    for v, name in await session.execute(
        select(ShareViewer, viewer_user.name)
        .outerjoin(viewer_user, viewer_user.id == ShareViewer.viewer_user_id)
        .where(ShareViewer.session_id.in_(share_ids))
        .order_by(ShareViewer.requested_at)
    ):
        viewers[v.session_id].append(
            {
                "name": _viewer_name(v, name, None),
                "kind": "user" if v.viewer_user_id else "guest",
                "status": v.status.value,
                "requested_at": v.requested_at,
                "granted_at": v.granted_at,
                "revoked_at": v.revoked_at,
            }
        )
    admin = aliased(User)
    views: dict[uuid.UUID, list[dict[str, Any]]] = {i: [] for i in share_ids}
    for entry, v, name, admin_name in await session.execute(
        select(AccessLog, ShareViewer, viewer_user.name, admin.name)
        .outerjoin(ShareViewer, ShareViewer.id == AccessLog.viewer_id)
        .outerjoin(viewer_user, viewer_user.id == ShareViewer.viewer_user_id)
        .outerjoin(admin, admin.id == AccessLog.admin_id)
        .where(AccessLog.session_id.in_(share_ids))
        .order_by(AccessLog.viewed_at, AccessLog.id)
    ):
        views[entry.session_id].append(
            {
                "viewer_name": _viewer_name(v, name, admin_name),
                "kind": "admin" if v is None else ("user" if v.viewer_user_id else "guest"),
                "channel": entry.channel.value,
                "viewed_at": entry.viewed_at,
            }
        )
    locations: dict[uuid.UUID, list[dict[str, Any]]] = {i: [] for i in share_ids}
    for loc in await session.scalars(select(Location).where(Location.session_id.in_(share_ids))):
        locations[loc.session_id].append(
            {
                "lat": loc.lat,
                "lng": loc.lng,
                "accuracy_m": loc.accuracy_m,
                "mocked": loc.mocked,
                "recorded_at": loc.recorded_at,
            }
        )
    share_sessions = [
        {
            "id": s.id,
            "source": s.source.value,
            "ends_when": s.ends_when.value,
            "status": s.status.value,
            "created_at": s.created_at,
            "ends_at": s.ends_at,
            "ended_at": s.ended_at,
            "ended_reason": s.ended_reason,
            "latest_location": locations[s.id],  # only while the share is live
            "viewers": viewers[s.id],
            "viewed_by": views[s.id],
        }
        for s in shares
    ]

    sharer = aliased(User)
    watching = [
        {
            "sharer_name": name,
            "status": v.status.value,
            # Only a granted viewer was shown the share; a pending or revoked one wasn't (or
            # isn't any more), so the sharer's activity isn't disclosed to them.
            "share_started_at": started if v.status is ViewerStatus.GRANTED else None,
            "requested_at": v.requested_at,
            "granted_at": v.granted_at,
            "revoked_at": v.revoked_at,
        }
        for v, name, started in await session.execute(
            select(ShareViewer, sharer.name, ShareSession.created_at)
            .join(ShareSession, ShareSession.id == ShareViewer.session_id)
            .join(sharer, sharer.id == ShareSession.sharer_id)
            .where(ShareViewer.viewer_user_id == user.id)
            .order_by(ShareViewer.requested_at)
        )
    ]

    contacts = [
        {
            "email": c.contact_email,
            "status": c.status.value,
            "created_at": c.created_at,
            "accepted_at": c.accepted_at,
        }
        for c in await session.scalars(
            select(Contact).where(Contact.owner_id == user.id).order_by(Contact.created_at)
        )
    ]
    scans = [
        {
            "gate": gate(s.gate_id),
            "direction": s.direction.value,
            "result": s.result.value,
            "distance_m": s.distance_m,
            "accuracy_m": s.accuracy_m,
            "outing_id": s.outing_id,
            "scanned_at": s.scanned_at,
        }
        for s in await session.scalars(
            select(GateScan).where(GateScan.user_id == user.id).order_by(GateScan.scanned_at)
        )
    ]
    devices = [
        {
            "platform": t.platform,
            "muted_channels": list(t.muted),
            "created_at": t.created_at,
            "last_seen_at": t.last_seen_at,
        }
        for t in await session.scalars(
            select(PushToken).where(PushToken.user_id == user.id).order_by(PushToken.created_at)
        )
    ]

    return {
        "format": "lumiback-export",
        "version": FORMAT_VERSION,
        "exported_at": datetime.now(UTC),
        "account": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "roll_no": user.roll_no,
            "role": user.role.value,
            "email_verified_at": user.email_verified_at,
            "created_at": user.created_at,
        },
        "profile": {
            "hostel": hostel(user.hostel_id),
            "hostel_at_sign_up": user.hostel,
            "phone": user.phone,
            "emergency_name": user.emergency_name,
            "emergency_relation": user.emergency_relation,
            "emergency_phone": user.emergency_phone,
            "emergency_email": user.emergency_email,
        },
        "contacts": contacts,
        "outings": outings,
        "outing_requests": requests,
        "share_sessions": share_sessions,
        "shares_watched": watching,
        "gate_scans": scans,
        "push_devices": devices,
    }
