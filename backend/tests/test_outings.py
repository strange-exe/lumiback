"""M1 outings: check out, extend, return, history, overdue (computed correctly in IST)."""

import threading
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from app.schemas import IST
from tests.helpers import signup


def iso(dt: datetime) -> str:
    return dt.isoformat()


def parse(value: str) -> datetime:
    return datetime.fromisoformat(value)


def in_ist(hours: float = 2) -> datetime:
    return (datetime.now(UTC) + timedelta(hours=hours)).astimezone(IST).replace(microsecond=0)


@pytest.fixture
def riya(client):
    return signup(client, "riya@geu.ac.in", "Riya")[1]


def check_out(client, headers, hours: float = 2, **extra):
    body = {"expected_return_at": iso(in_ist(hours)), **extra}
    return client.post("/outings", json=body, headers=headers)


def make_overdue(db, minutes: int = 10) -> None:
    db.execute(
        text(
            "UPDATE outings SET left_at = now() - interval '3 hours', "
            "expected_return_at = now() - make_interval(mins => :m) WHERE returned_at IS NULL"
        ),
        {"m": minutes},
    )
    db.commit()


# ---------- check out ----------


def test_check_out_records_the_trip_in_ist(client, riya):
    expected = in_ist(2)
    r = client.post(
        "/outings",
        json={
            "destination": "Clock Tower",
            "purpose": "Groceries",
            "expected_return_at": iso(expected),
        },
        headers=riya,
    )
    assert r.status_code == 201, r.text
    o = r.json()
    assert o["status"] == "out" and o["returned_at"] is None
    assert (o["destination"], o["purpose"]) == ("Clock Tower", "Groceries")
    assert o["expected_return_at"].endswith("+05:30") and o["left_at"].endswith("+05:30")
    assert parse(o["expected_return_at"]) == expected
    assert abs(parse(o["left_at"]) - datetime.now(UTC)) < timedelta(seconds=30)


def test_utc_input_is_the_same_instant_shown_in_ist(client, riya):
    expected_utc = (datetime.now(UTC) + timedelta(hours=3)).replace(microsecond=0)
    r = client.post("/outings", json={"expected_return_at": expected_utc.isoformat()}, headers=riya)
    shown = r.json()["expected_return_at"]
    assert shown.endswith("+05:30")
    assert parse(shown) == expected_utc  # same moment, different offset


@pytest.mark.parametrize(
    "body",
    [
        {"expected_return_at": "2026-10-05T20:00:00"},  # naive: ambiguous
        {"expected_return_at": iso(datetime.now(UTC) - timedelta(minutes=5))},  # past
        {"expected_return_at": iso(datetime.now(UTC) + timedelta(days=8))},  # too long
        {"expected_return_at": iso(in_ist(2)), "status": "returned"},  # unknown field
        {"expected_return_at": iso(in_ist(2)), "destination": "x" * 101},
        {"destination": "Library"},  # expected return is required
    ],
)
def test_invalid_check_outs_rejected(client, riya, body):
    assert client.post("/outings", json=body, headers=riya).status_code == 422


def test_cannot_check_out_twice(client, riya):
    assert check_out(client, riya).status_code == 201
    assert check_out(client, riya).status_code == 409


def test_simultaneous_double_tap_creates_one_outing(client, riya, db):
    """The old app's bug: two open outings from a double submit. The DB now prevents it."""
    results: list[int] = []
    barrier = threading.Barrier(2)

    def tap():
        barrier.wait()
        results.append(check_out(client, riya).status_code)

    threads = [threading.Thread(target=tap) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)
    assert sorted(results) == [201, 409]
    assert db.execute(text("SELECT count(*) FROM outings")).scalar_one() == 1


# ---------- return ----------


def test_return_closes_the_outing_with_server_time(client, riya):
    check_out(client, riya)
    r = client.post("/outings/current/return", headers=riya)
    assert r.status_code == 200
    o = r.json()
    assert o["status"] == "returned"
    assert abs(parse(o["returned_at"]) - datetime.now(UTC)) < timedelta(seconds=30)
    assert o["late_minutes"] == 0 and o["duration_minutes"] == 0
    assert client.get("/outings/current", headers=riya).json() is None
    assert client.post("/outings/current/return", headers=riya).status_code == 404
    assert check_out(client, riya).status_code == 201  # free to go out again


# ---------- overdue ----------


def test_overdue_is_computed_from_the_expected_time(client, riya, db):
    check_out(client, riya)
    make_overdue(db, minutes=10)
    o = client.get("/outings/current", headers=riya).json()
    assert o["status"] == "overdue"
    assert 10 <= o["late_minutes"] <= 11
    assert client.get("/outings/summary", headers=riya).json()["currently"] == "overdue"

    back = client.post("/outings/current/return", headers=riya).json()
    assert back["status"] == "returned" and back["late_minutes"] >= 10
    assert back["duration_minutes"] >= 180


def test_overdue_boundary_in_ist(client, riya, db):
    """An expected return of 20:00 IST is overdue at 20:01 IST and not at 19:59 IST."""
    check_out(client, riya)
    for offset_s, status in ((-60, "overdue"), (60, "out")):
        expected_ist = (datetime.now(UTC) + timedelta(seconds=offset_s)).astimezone(IST)
        db.execute(
            text("UPDATE outings SET left_at = now() - interval '1 hour', expected_return_at = :e"),
            {"e": expected_ist},
        )
        db.commit()
        assert client.get("/outings/current", headers=riya).json()["status"] == status


def test_extending_clears_overdue(client, riya, db):
    check_out(client, riya)
    make_overdue(db)
    later = in_ist(1)
    r = client.patch("/outings/current", json={"expected_return_at": iso(later)}, headers=riya)
    assert r.status_code == 200
    assert r.json()["status"] == "out" and parse(r.json()["expected_return_at"]) == later


def test_extend_rules(client, riya):
    past = iso(datetime.now(UTC) - timedelta(minutes=1))
    assert (
        client.patch(
            "/outings/current", json={"expected_return_at": iso(in_ist(1))}, headers=riya
        ).status_code
        == 404
    )
    check_out(client, riya)
    assert (
        client.patch(
            "/outings/current", json={"expected_return_at": past}, headers=riya
        ).status_code
        == 422
    )
    too_far = iso(datetime.now(UTC) + timedelta(days=8))
    assert (
        client.patch(
            "/outings/current", json={"expected_return_at": too_far}, headers=riya
        ).status_code
        == 422
    )


# ---------- history & summary ----------


def test_history_is_newest_first_and_paginates(client, riya):
    for place in ("Library", "Market", "Station"):
        check_out(client, riya, destination=place)
        client.post("/outings/current/return", headers=riya)

    first = client.get("/outings?limit=2", headers=riya).json()
    assert [o["destination"] for o in first["items"]] == ["Station", "Market"]
    assert first["next_before"] is not None

    rest = client.get("/outings", params={"limit": 2, "before": first["next_before"]}, headers=riya)
    assert [o["destination"] for o in rest.json()["items"]] == ["Library"]
    assert rest.json()["next_before"] is None


def test_history_requires_timezone_in_cursor(client, riya):
    r = client.get("/outings", params={"before": "2026-10-05T10:00:00"}, headers=riya)
    assert r.status_code == 422


def test_summary_counts_on_time_and_late(client, riya, db):
    check_out(client, riya)
    client.post("/outings/current/return", headers=riya)  # on time
    check_out(client, riya)
    make_overdue(db)
    client.post("/outings/current/return", headers=riya)  # late
    check_out(client, riya)  # still out

    s = client.get("/outings/summary", headers=riya).json()
    assert s == {
        "total": 3,
        "returned": 2,
        "returned_late": 1,
        "on_time_rate": 0.5,
        "currently": "out",
    }


def test_students_only_see_their_own_outings(client, riya):
    check_out(client, riya, destination="Secret Cafe")
    _, arjun = signup(client, "arjun@geu.ac.in", "Arjun")
    assert client.get("/outings", headers=arjun).json() == {"items": [], "next_before": None}
    assert client.get("/outings/current", headers=arjun).json() is None
    assert client.post("/outings/current/return", headers=arjun).status_code == 404
    assert client.get("/outings/current", headers=riya).json()["status"] == "out"


def test_outings_require_authentication(client):
    assert client.get("/outings").status_code == 401
    assert client.post("/outings", json={"expected_return_at": iso(in_ist(1))}).status_code == 401
