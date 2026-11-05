"""GET /health reports whether the background sweep is still finishing, without failing on it."""

import asyncio

import pytest
from fastapi.testclient import TestClient

from app.jobs import expiry
from app.jobs.expiry import SweepHealth
from app.main import create_app


class Ticks:
    """A monotonic clock the test moves by hand."""

    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def test_a_fresh_process_gets_three_intervals_of_grace():
    ticks = Ticks()
    health = SweepHealth(interval=30, clock=ticks)
    assert health.status() == "ok"
    ticks.now += 90
    assert health.status() == "ok"  # exactly three intervals: still within grace
    ticks.now += 1
    assert health.status() == "stale"


def test_a_successful_sweep_clears_stale_and_restarts_the_count():
    ticks = Ticks()
    health = SweepHealth(interval=30, clock=ticks)
    ticks.now += 500
    assert health.status() == "stale"
    health.mark_ok()
    assert health.status() == "ok"
    ticks.now += 91
    assert health.status() == "stale"


def test_run_forever_marks_only_successful_sweeps(monkeypatch):
    planned = [RuntimeError("database hiccup"), None, RuntimeError("again"), None]
    ran = []
    marks = []

    async def fake_sweep(*_args):
        outcome = planned[len(ran) % len(planned)]
        ran.append(outcome is None)
        if outcome is not None:
            raise outcome

    class Recorder(SweepHealth):
        def mark_ok(self) -> None:
            marks.append(True)

    async def run() -> None:
        task = asyncio.create_task(
            expiry.run_forever(None, None, interval=0, health=Recorder())  # type: ignore[arg-type]
        )
        while len(ran) < len(planned):
            await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    monkeypatch.setattr(expiry, "sweep", fake_sweep)
    asyncio.run(asyncio.wait_for(run(), timeout=5))
    # A failed sweep doesn't stop the loop, and only successful ones count as fresh.
    assert len(ran) >= len(planned)
    assert len(marks) == ran.count(True)


def test_health_says_off_when_this_process_runs_no_sweep(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "sweep": "off"}


def test_a_stale_sweep_is_reported_but_health_stays_200(client):
    ticks = Ticks()
    client.app.state.sweep_health = SweepHealth(interval=30, clock=ticks)
    assert client.get("/health").json() == {"status": "ok", "sweep": "ok"}
    ticks.now += 120
    res = client.get("/health")
    # 200 on purpose: Render restarts a service whose health check fails.
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "sweep": "stale"}


class CountingSessions:
    """Wraps the app's sessionmaker and counts the sessions opened through it."""

    def __init__(self, inner) -> None:
        self.inner = inner
        self.opened = 0

    def __call__(self, *args, **kwargs):
        self.opened += 1
        return self.inner(*args, **kwargs)


def test_a_burst_of_health_checks_touches_the_database_once(client):
    """/health needs no sign-in: a flood of pings must not take every pooled connection."""
    ticks = Ticks()
    client.app.state.health_clock = ticks
    counter = CountingSessions(client.app.state.sessionmaker)
    client.app.state.sessionmaker = counter
    for _ in range(20):
        assert client.get("/health").json() == {"status": "ok", "sweep": "off"}
    assert counter.opened == 1
    ticks.now += 4.9
    client.get("/health")
    assert counter.opened == 1
    ticks.now += 0.2  # past the 5 s the answer is kept
    client.get("/health")
    assert counter.opened == 2


def test_a_cached_health_answer_still_reports_the_sweep_as_it_is_now(client):
    client.app.state.health_clock = Ticks()  # stands still: the database answer stays cached
    sweep_ticks = Ticks()
    client.app.state.sweep_health = SweepHealth(interval=30, clock=sweep_ticks)
    assert client.get("/health").json()["sweep"] == "ok"
    sweep_ticks.now += 120  # the sweep has gone stale since
    assert client.get("/health").json() == {"status": "ok", "sweep": "stale"}


def test_a_database_outage_is_reported_and_kept_briefly_too(client):
    ticks = Ticks()
    client.app.state.health_clock = ticks

    def broken():
        raise ConnectionError("database down")

    client.app.state.sessionmaker = CountingSessions(broken)
    for _ in range(3):
        res = client.get("/health")
        assert res.status_code == 503
        assert res.json() == {"status": "database unavailable"}
    assert client.app.state.sessionmaker.opened == 1


def test_the_running_app_reports_its_own_sweep(settings, clean_db):
    app = create_app(settings)
    with TestClient(app, backend_options={"loop_factory": asyncio.SelectorEventLoop}) as c:
        assert isinstance(app.state.sweep_health, SweepHealth)
        assert c.get("/health").json() == {"status": "ok", "sweep": "ok"}
