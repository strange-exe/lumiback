"""In-process pub/sub between HTTP actions and live WebSocket subscribers.

Events carry no authority. Subscribers re-run `can_view` against the database before acting
on any event, so a stale or forged event can never grant access.

Single process only (M0). For several instances, back this with Postgres LISTEN/NOTIFY or Redis
behind the same interface.
"""

import asyncio
import logging
import uuid
from collections import defaultdict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class LocationUpdated:
    session_id: uuid.UUID


@dataclass(frozen=True)
class AccessChanged:
    """Session stopped/expired or a viewer revoked: every subscriber must re-check access."""

    session_id: uuid.UUID


Event = LocationUpdated | AccessChanged
Subscriber = Callable[[Event], Awaitable[None]]


class Hub:
    def __init__(self) -> None:
        self._subscribers: dict[uuid.UUID, set[Subscriber]] = defaultdict(set)

    def subscribe(self, session_id: uuid.UUID, subscriber: Subscriber) -> None:
        self._subscribers[session_id].add(subscriber)

    def unsubscribe(self, session_id: uuid.UUID, subscriber: Subscriber) -> None:
        subs = self._subscribers.get(session_id)
        if subs is not None:
            subs.discard(subscriber)
            if not subs:
                del self._subscribers[session_id]

    def subscriber_count(self, session_id: uuid.UUID) -> int:
        return len(self._subscribers.get(session_id, ()))

    async def publish(self, event: Event) -> None:
        # Copy: subscribers may unsubscribe themselves while handling the event. Run them
        # concurrently so one slow connection cannot delay everyone else's cut-off.
        subscribers = list(self._subscribers.get(event.session_id, ()))
        results = await asyncio.gather(*(s(event) for s in subscribers), return_exceptions=True)
        for result in results:
            if isinstance(result, Exception):
                logger.warning("subscriber failed for %s: %r", event.session_id, result)
