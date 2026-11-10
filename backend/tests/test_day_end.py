"""The test rules' day end. The open rules (conftest.seed_open_rules) close at 23:59 IST and a
tap-out needs a minute ahead (rules.MIN_AHEAD), so from 23:58 IST every check-out is refused
"Try again tomorrow". A run that crossed midnight IST (2026-11-10/11) failed three view-as tests
on it; clean_db now waits out the day's last minutes before a test starts."""

from datetime import datetime, time, timedelta

import pytest

from app.services import outings as outings_service
from app.services.rules import IST
from tests import conftest
from tests.helpers import signup
from tests.test_escalations import go_out


def tonight_at(clock: time) -> datetime:
    """`clock` on today's IST date (any wall-clock date works: the rules are open every day)."""
    return datetime.combine(datetime.now(IST).date(), clock, tzinfo=IST)


class WallClock:
    """A fake wall clock: `sleep` moves it on instead of waiting."""

    def __init__(self, start: datetime) -> None:
        self.at = start
        self.slept = 0.0

    def now(self) -> datetime:
        return self.at

    def sleep(self, seconds: float) -> None:
        self.slept += seconds
        self.at += timedelta(seconds=seconds)


def check_out_at(monkeypatch, wall: WallClock) -> None:
    """Make check-out read `wall` (left_at still comes from the database clock)."""

    class Frozen(datetime):
        @classmethod
        def now(cls, tz=None):
            return wall.now().astimezone(tz)

    monkeypatch.setattr(outings_service, "datetime", Frozen)


def test_the_open_rules_refuse_a_tap_out_from_2358(client, monkeypatch):
    """The cause, reproduced: the same go_out the view-as tests use, at 23:58:30 IST."""
    _, riya = signup(client, "riya@example.com", "Riya")
    check_out_at(monkeypatch, WallClock(tonight_at(time(23, 58, 30))))
    r = client.post("/outings", json={"destination": "Rajpur Road"}, headers=riya)
    assert r.status_code == 403, r.text
    assert "Try again tomorrow" in r.json()["detail"]


def test_a_test_starting_at_2358_waits_for_the_new_day(client, monkeypatch):
    wall = WallClock(tonight_at(time(23, 58, 30)))
    conftest.wait_out_day_end(wall.now, wall.sleep)
    assert wall.now().astimezone(IST).time() < time(0, 1)  # just into the new day
    _, riya = signup(client, "riya@example.com", "Riya")
    check_out_at(monkeypatch, wall)
    go_out(client, riya)


@pytest.mark.parametrize("clock", [time(0, 0), time(12, 0), time(23, 56, 59)])
def test_the_rest_of_the_day_never_waits(clock):
    wall = WallClock(tonight_at(clock))
    conftest.wait_out_day_end(wall.now, wall.sleep)
    assert wall.slept == 0


def test_the_last_moment_before_the_wait_still_has_a_minute_to_tap_out(client, monkeypatch):
    """The margin covers the closing minute plus a minute for the test itself to run."""
    start = tonight_at(time(0, 0)) + timedelta(days=1) - conftest.DAY_END_MARGIN
    wall = WallClock(start - timedelta(microseconds=1))
    conftest.wait_out_day_end(wall.now, wall.sleep)
    assert wall.slept == 0
    _, riya = signup(client, "riya@example.com", "Riya")
    check_out_at(monkeypatch, WallClock(wall.now() + timedelta(minutes=1)))
    go_out(client, riya)
