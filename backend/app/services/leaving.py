"""A share tab that is closing says so first; its share ends a short grace later unless it stays.

The tab's stop beacon (sent on `pagehide`) is the instant way a closed tab ends its share, but
the browser may tear a slow page down before that handler runs, and then the share would run
until the sweep notices the tab went quiet (expiry.TAB_IDLE, minutes). So the tab also sends a
"leaving" beacon from `beforeunload`, which the browser waits for. That can't end the share at
once: the student may cancel "Leave site?". So it only marks the share, and:

- the API ends it after `grace` if the mark is still the same one (this process, a timer);
- the sweep ends any share whose mark is older than `grace` (a restart lost the timer);
- a tab that stayed clears the mark (DELETE), and nothing ends.

Only tab-live shares are marked: closing the tab only pauses an outing's share, and app shares
have no tab.
"""

import asyncio
import logging
import uuid
from collections.abc import Coroutine
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import ColumnElement, and_, delete, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import Location, SessionStatus, ShareSession, ShareSource
from app.realtime import AccessChanged, Hub

logger = logging.getLogger(__name__)

TAB_CLOSED = "tab_closed"


async def mark(session: AsyncSession, share_id: uuid.UUID) -> datetime | None:
    """Mark a live tab share as leaving. Returns the mark, or None if nothing was marked."""
    now = datetime.now(UTC)
    marked = (
        await session.execute(
            update(ShareSession)
            .where(
                ShareSession.id == share_id,
                ShareSession.status == SessionStatus.ACTIVE,
                ShareSession.source == ShareSource.TAB_LIVE,
            )
            .values(leaving_at=now)
            .returning(ShareSession.id)
        )
    ).scalar_one_or_none()
    await session.commit()
    return now if marked is not None else None


async def clear(session: AsyncSession, share_id: uuid.UUID) -> None:
    """The tab stayed: forget the mark."""
    await session.execute(
        update(ShareSession).where(ShareSession.id == share_id).values(leaving_at=None)
    )
    await session.commit()


def left_before(cutoff: datetime) -> ColumnElement[bool]:
    """Tab shares whose tab said it was leaving before `cutoff` and never said it stayed."""
    return and_(
        ShareSession.source == ShareSource.TAB_LIVE,
        ShareSession.leaving_at.is_not(None),
        ShareSession.leaving_at <= cutoff,
    )


async def end_if_still_left(
    sessionmaker: async_sessionmaker[AsyncSession],
    hub: Hub,
    share_id: uuid.UUID,
    marked: datetime,
    grace: timedelta,
) -> None:
    """After `grace`, end the share if its mark is still `marked`: not cleared (the tab stayed)
    and not replaced (a later leave starts its own timer)."""
    await asyncio.sleep(grace.total_seconds())
    async with sessionmaker() as session:
        ended = (
            await session.execute(
                update(ShareSession)
                .where(
                    ShareSession.id == share_id,
                    ShareSession.status == SessionStatus.ACTIVE,
                    ShareSession.leaving_at == marked,
                )
                .values(
                    status=SessionStatus.ENDED, ended_at=datetime.now(UTC), ended_reason=TAB_CLOSED
                )
                .returning(ShareSession.id)
            )
        ).scalar_one_or_none()
        if ended is None:
            return
        await session.execute(delete(Location).where(Location.session_id == share_id))
        await session.commit()
    await hub.publish(AccessChanged(share_id))


class Timers:
    """The leave timers this process is running. Kept so they aren't garbage-collected mid-wait
    and can be cancelled on shutdown (the sweep then ends what they would have)."""

    def __init__(self) -> None:
        self._tasks: set[asyncio.Task[None]] = set()

    def start(self, work: Coroutine[Any, Any, None]) -> None:
        task = asyncio.create_task(work)
        self._tasks.add(task)
        task.add_done_callback(self._done)

    def _done(self, task: asyncio.Task[None]) -> None:
        self._tasks.discard(task)
        if not task.cancelled() and task.exception() is not None:
            # The sweep ends the share instead; this only says the fast path failed.
            logger.error("leave timer failed", exc_info=task.exception())

    async def cancel_all(self) -> None:
        for task in list(self._tasks):
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
