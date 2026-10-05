"""Postgres-backed rate limiter: shared across instances, atomic under concurrency."""

import asyncio
import hashlib
import hmac
from datetime import timedelta

import pytest
from sqlalchemy import text

from app.jobs.expiry import sweep
from app.security.rate_limit import Limit, RateLimited, RateLimiter
from tests.conftest import FAKE_SECRET, FakeClock

PEPPER = FAKE_SECRET[::-1]
FIVE_PER_MINUTE = Limit(max_hits=5, window_seconds=60)


@pytest.fixture
def make_limiter(client):
    def _make(clock=None) -> RateLimiter:
        kwargs = {"clock": clock} if clock else {}
        return RateLimiter(client.app.state.sessionmaker, PEPPER, **kwargs)

    return _make


def run(client, coro_fn, *args):
    return client.portal.call(coro_fn, *args)


def test_concurrent_hits_cannot_exceed_the_limit(client, make_limiter):
    limiter = make_limiter()

    async def burst() -> int:
        async def one() -> bool:
            try:
                await limiter.hit("t", "same-key", FIVE_PER_MINUTE)
                return True
            except RateLimited:
                return False

        return sum(await asyncio.gather(*(one() for _ in range(20))))

    assert run(client, burst) == 5


def test_limits_are_shared_between_instances(client, make_limiter):
    """Two limiter objects stand in for two API servers using the same database."""
    server_a, server_b = make_limiter(), make_limiter()
    for _ in range(3):
        run(client, server_a.hit, "t", "k", FIVE_PER_MINUTE)
    for _ in range(2):
        run(client, server_b.hit, "t", "k", FIVE_PER_MINUTE)
    with pytest.raises(RateLimited):
        run(client, server_a.hit, "t", "k", FIVE_PER_MINUTE)


def test_window_slides_and_retry_after_is_accurate(client, make_limiter):
    clock = FakeClock()
    limiter = make_limiter(clock)
    for _ in range(5):
        run(client, limiter.hit, "t", "k", FIVE_PER_MINUTE)
        clock.advance(10)  # hits at 0, 10, 20, 30, 40 s; now = 50 s
    with pytest.raises(RateLimited) as exc:
        run(client, limiter.hit, "t", "k", FIVE_PER_MINUTE)
    assert exc.value.retry_after == 10  # the hit at 0 s leaves the window at 60 s

    clock.advance(11)
    run(client, limiter.hit, "t", "k", FIVE_PER_MINUTE)  # oldest slid out


def test_scopes_and_keys_are_independent(client, make_limiter):
    limiter = make_limiter()
    for _ in range(5):
        run(client, limiter.hit, "login", "riya@geu.ac.in", FIVE_PER_MINUTE)
    run(client, limiter.hit, "login", "arjun@geu.ac.in", FIVE_PER_MINUTE)
    run(client, limiter.hit, "resend", "riya@geu.ac.in", FIVE_PER_MINUTE)


def test_record_counts_failures_without_raising_and_reset_clears(client, make_limiter):
    limiter = make_limiter()
    for _ in range(7):
        run(client, limiter.record, "t", "k")  # never raises, even past the limit
    with pytest.raises(RateLimited):
        run(client, limiter.check, "t", "k", FIVE_PER_MINUTE)
    run(client, limiter.reset, "t", "k")
    run(client, limiter.check, "t", "k", FIVE_PER_MINUTE)


def test_keys_are_stored_only_as_hmac(client, make_limiter, db):
    run(client, make_limiter().hit, "login", "riya@geu.ac.in", FIVE_PER_MINUTE)
    scope, key_hash = db.execute(text("SELECT scope, key_hash FROM rate_limit_hits")).one()
    assert scope == "login"
    expected = hmac.new(PEPPER.encode(), b"login:riya@geu.ac.in", hashlib.sha256).digest()
    assert key_hash == expected
    assert b"riya" not in key_hash


def test_sweep_deletes_old_hits(client, make_limiter, db):
    clock = FakeClock()
    clock.advance(-timedelta(days=2).total_seconds())
    run(client, make_limiter(clock).hit, "t", "old", FIVE_PER_MINUTE)
    run(client, make_limiter().hit, "t", "new", FIVE_PER_MINUTE)

    result = run(client, sweep, client.app.state.sessionmaker, client.app.state.hub)
    assert result.deleted_rate_limit_hits == 1
    assert db.execute(text("SELECT count(*) FROM rate_limit_hits")).scalar_one() == 1


def test_login_lockout_survives_an_api_restart(client, clock):
    """Limits live in the database, so a new limiter (e.g. after a restart) still enforces them."""
    from tests.helpers import register

    register(client, "riya@geu.ac.in")
    for _ in range(5):
        client.post("/auth/login", json={"email": "riya@geu.ac.in", "password": "wrong-pass-1"})
    client.app.state.limiter = RateLimiter(
        client.app.state.sessionmaker, PEPPER, clock=clock
    )  # "restarted" server
    r = client.post("/auth/login", json={"email": "riya@geu.ac.in", "password": "wrong-pass-1"})
    assert r.status_code == 429
