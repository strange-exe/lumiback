"""Help requests for the hostel office: students who pressed Help while out (saved and alerted
in services/alerts.py). A warden sees their hostels' only (by the outing's hostel); anyone
else's is a 404, as if it didn't exist."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models import HelpRequest, Hostel, Outing, User
from app.schemas import HelpRequestOut
from app.services.staff import Staff


class NotFound(Exception):
    pass


async def listing(session: AsyncSession, staff: Staff, *, open_only: bool) -> list[HelpRequestOut]:
    handler = aliased(User)
    query = (
        select(HelpRequest, User, Hostel.name, Outing.returned_at, handler.name)
        .join(User, User.id == HelpRequest.student_id)
        .outerjoin(Hostel, Hostel.id == HelpRequest.hostel_id)
        .outerjoin(Outing, Outing.id == HelpRequest.outing_id)
        .outerjoin(handler, handler.id == HelpRequest.handled_by)
        .where(staff.covers(HelpRequest.hostel_id))
        .order_by(HelpRequest.created_at.desc())
        .limit(100)
    )
    if open_only:
        query = query.where(HelpRequest.handled_at.is_(None))
    return [
        HelpRequestOut(
            id=h.id,
            created_at=h.created_at,
            student_id=s.id,
            name=s.name,
            roll_no=s.roll_no,
            phone=s.phone,
            hostel=hostel,
            lat=h.lat,
            lng=h.lng,
            accuracy_m=h.accuracy_m,
            mocked=h.mocked,
            returned=h.outing_id is None or returned_at is not None,
            handled_by=handled_by,
            handled_at=h.handled_at,
            note=h.note,
        )
        for h, s, hostel, returned_at, handled_by in await session.execute(query)
    ]


async def handle(session: AsyncSession, staff: Staff, help_id: uuid.UUID, note: str | None) -> bool:
    """Marks it handled; False if it already was (the first note stays)."""
    h = await session.get(HelpRequest, help_id, with_for_update=True)
    if h is None or not staff.covers_hostel(h.hostel_id):
        raise NotFound
    if h.handled_at is not None:
        return False
    h.handled_at = datetime.now(UTC)
    h.handled_by = staff.user.id
    h.note = note
    return True
