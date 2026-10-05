"""In-memory sliding-window rate limiter.

Single process only (M0). If the API runs as several instances, swap this for a shared store
(Postgres or Redis) behind the same `hit()` / `reset()` interface.
"""

import math
import time
from collections import defaultdict, deque
from collections.abc import Callable
from dataclasses import dataclass


@dataclass(frozen=True)
class Limit:
    max_hits: int
    window_seconds: float


class RateLimited(Exception):
    def __init__(self, retry_after: int) -> None:
        super().__init__(f"retry after {retry_after}s")
        self.retry_after = retry_after


class RateLimiter:
    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._hits: dict[tuple[str, str], deque[float]] = defaultdict(deque)

    def _window(self, scope: str, key: str, limit: Limit) -> deque[float]:
        hits = self._hits[(scope, key)]
        cutoff = self._clock() - limit.window_seconds
        while hits and hits[0] <= cutoff:
            hits.popleft()
        return hits

    def check(self, scope: str, key: str, limit: Limit) -> None:
        """Raise RateLimited if the key is already at its limit (does not record a hit)."""
        hits = self._window(scope, key, limit)
        if len(hits) >= limit.max_hits:
            retry = hits[0] + limit.window_seconds - self._clock()
            raise RateLimited(max(1, math.ceil(retry)))

    def hit(self, scope: str, key: str, limit: Limit) -> None:
        """Check, then record one hit."""
        self.check(scope, key, limit)
        self._hits[(scope, key)].append(self._clock())

    def reset(self, scope: str, key: str) -> None:
        self._hits.pop((scope, key), None)
