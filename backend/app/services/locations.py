"""Latest-location storage and the access log.

Only one row per session is ever kept (upsert). It is deleted when the session ends.
"""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AccessChannel,
    AccessLog,
    Location,
    SessionStatus,
    ShareSession,
    ShareViewer,
    User,
)
from app.schemas import AccessLogEntry, LocationIn, LocationOut

STALE_AFTER = timedelta(seconds=60)
MAX_CLOCK_SKEW = timedelta(minutes=2)


class FutureTimestamp(Exception):
    """recorded_at is too far ahead of server time."""


class SessionNotLive(Exception):
    """The session ended (or expired) before this update could be stored."""


async def upsert(session: AsyncSession, share_id: uuid.UUID, body: LocationIn) -> None:
    now = datetime.now(UTC)
    if body.recorded_at > now + MAX_CLOCK_SKEW:
        raise FutureTimestamp
    # Recording the check-in UPDATEs the session row, which locks it against `stop` (an UPDATE of
    # the same row): either this location is written first and stop deletes it, or stop wins and
    # the WHERE no longer matches. Without the lock, a location could outlive a stopped session.
    # (An exclusive lock from the start: two writers upgrading FOR SHARE locks would deadlock.)
    live = (
        await session.execute(
            update(ShareSession)
            .where(
                ShareSession.id == share_id,
                ShareSession.status == SessionStatus.ACTIVE,
                ShareSession.ends_at > now,
            )
            .values(sharer_seen_at=now)
            .returning(ShareSession.id)
        )
    ).scalar_one_or_none()
    if live is None:
        await session.rollback()
        raise SessionNotLive
    values = body.model_dump()
    await session.execute(
        insert(Location)
        .values(session_id=share_id, **values)
        .on_conflict_do_update(
            index_elements=["session_id"],
            set_=values,
            # Out-of-order delivery must never replace a newer fix with an older one.
            where=Location.recorded_at < body.recorded_at,
        )
    )
    await session.commit()


async def latest(session: AsyncSession, share_id: uuid.UUID) -> LocationOut | None:
    loc = await session.get(Location, share_id, populate_existing=True)
    if loc is None:
        return None
    return LocationOut(
        lat=loc.lat,
        lng=loc.lng,
        accuracy_m=loc.accuracy_m,
        recorded_at=loc.recorded_at,
        stale=datetime.now(UTC) - loc.recorded_at > STALE_AFTER,
    )


async def log_access(
    session: AsyncSession, share_id: uuid.UUID, viewer_id: uuid.UUID, channel: AccessChannel
) -> None:
    session.add(AccessLog(session_id=share_id, viewer_id=viewer_id, channel=channel))
    await session.commit()


async def access_log(
    session: AsyncSession, share_id: uuid.UUID, limit: int = 200
) -> list[AccessLogEntry]:
    rows = await session.execute(
        select(AccessLog, ShareViewer, User.name)
        .join(ShareViewer, ShareViewer.id == AccessLog.viewer_id)
        .outerjoin(User, User.id == ShareViewer.viewer_user_id)
        .where(AccessLog.session_id == share_id)
        .order_by(AccessLog.viewed_at.desc(), AccessLog.id.desc())
        .limit(limit)
    )
    return [
        AccessLogEntry(
            viewer_id=viewer.id,
            viewer_name=name if viewer.viewer_user_id else (viewer.guest_label or "Guest"),
            kind="user" if viewer.viewer_user_id else "guest",
            channel=entry.channel.value,
            viewed_at=entry.viewed_at,
        )
        for entry, viewer, name in rows
    ]
