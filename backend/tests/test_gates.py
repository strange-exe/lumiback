"""Gate tap-out / tap-in: the rotating code, the GPS check, direction, replay and outing rules."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from app.security.gate_codes import gate_code, qr_payload, window_at
from tests.conftest import FAKE_SECRET, OPEN_RULES
from tests.helpers import (
    GATE,
    create_gate,
    kiosk_qr,
    make_admin,
    set_rules,
    signup,
)

AT_GATE = {"lat": GATE["lat"], "lng": GATE["lng"], "accuracy_m": 8}
METRES_PER_DEGREE_LAT = 111_195


def north(metres: float) -> dict:
    return {**AT_GATE, "lat": GATE["lat"] + metres / METRES_PER_DEGREE_LAT}


def soon(hours: float = 2) -> str:
    return (datetime.now(UTC) + timedelta(hours=hours)).isoformat()


@pytest.fixture
def admin(client, db):
    _, headers = signup(client, "warden@example.com", "Warden")
    make_admin(db, "warden@example.com")
    return headers


@pytest.fixture
def gate(client, admin):
    return create_gate(client, admin)


@pytest.fixture
def riya(client):
    return signup(client, "riya@example.com", "Riya")[1]


def scan(client, headers, qr, where=AT_GATE, **extra):
    return client.post("/gates/scan", json={"qr": qr, **where, **extra}, headers=headers)


def scans(db) -> list[tuple]:
    return [
        tuple(r)
        for r in db.execute(
            text("SELECT direction, result, gate_id IS NOT NULL FROM gate_scans ORDER BY id")
        )
    ]


def age_scans(db, seconds: int = 120) -> None:
    """Move past the replay window without waiting."""
    db.execute(
        text("UPDATE gate_scans SET scanned_at = scanned_at - make_interval(secs => :s)"),
        {"s": seconds},
    )
    db.commit()


# ---------- tap out / tap in ----------


def test_tap_out_then_tap_in_at_the_gate(client, db, gate, riya):
    qr = kiosk_qr(client, gate["kiosk_token"])
    out = scan(client, riya, qr, expected_return_at=soon(), destination="Paltan Bazaar")
    assert out.status_code == 200, out.text
    body = out.json()
    assert body["direction"] == "out"
    assert body["gate"] == "Main Gate"
    assert body["outing"]["out_via"] == "gate"
    assert body["outing"]["destination"] == "Paltan Bazaar"
    assert body["outing"]["returned_at"] is None

    age_scans(db)
    back = scan(client, riya, kiosk_qr(client, gate["kiosk_token"]))
    assert back.status_code == 200, back.text
    assert back.json()["direction"] == "in"
    assert back.json()["outing"]["id"] == body["outing"]["id"]
    assert back.json()["outing"]["in_via"] == "gate"
    assert back.json()["outing"]["returned_at"] is not None

    row = db.execute(text("SELECT out_gate_id = in_gate_id, out_gate_id::text FROM outings")).one()
    assert row == (True, gate["gate"]["id"])
    assert scans(db) == [("out", "accepted", True), ("in", "accepted", True)]


def test_tap_out_returns_by_todays_rule(client, db, gate, riya):
    rules = set_rules(db, "open")
    r = scan(client, riya, kiosk_qr(client, gate["kiosk_token"]))
    assert r.status_code == 200, r.text
    expected = datetime.fromisoformat(r.json()["outing"]["expected_return_at"])
    assert expected.utcoffset() == timedelta(hours=5, minutes=30)  # on the campus clock
    assert expected.strftime("%H:%M") == rules["return_by"]


def test_a_return_time_sent_by_an_older_app_is_ignored(client, db, gate, riya):
    rules = set_rules(db, "open")
    r = scan(client, riya, kiosk_qr(client, gate["kiosk_token"]), expected_return_at=soon(30))
    assert r.status_code == 200, r.text
    expected = datetime.fromisoformat(r.json()["outing"]["expected_return_at"])
    assert expected.strftime("%H:%M") == rules["return_by"]


def test_outside_the_window_tap_out_is_refused_and_logged(client, db, gate, riya):
    set_rules(db, "closed")
    r = scan(client, riya, kiosk_qr(client, gate["kiosk_token"]))
    assert r.status_code == 422
    assert "outings end at" in r.json()["detail"]
    assert client.get("/outings/current", headers=riya).json() is None
    assert scans(db) == [("out", "not_allowed", True)]


def test_tapping_in_is_never_refused_by_the_rules(client, db, gate, riya):
    set_rules(db, "open")
    assert scan(client, riya, kiosk_qr(client, gate["kiosk_token"])).status_code == 200
    set_rules(db, "closed")  # the window closed while they were out
    age_scans(db)
    back = scan(client, riya, kiosk_qr(client, gate["kiosk_token"]))
    assert back.status_code == 200, back.text
    assert back.json()["direction"] == "in"


def test_campus_shows_todays_rules(client, db, riya):
    set_rules(db, "open")
    r = client.get("/campus", headers=riya)
    assert r.status_code == 200, r.text
    body = r.json()
    today = body["today"]
    assert today["rule_set"] == OPEN_RULES and today["hostel"] is None  # the campus default
    assert today["needs_form"] is False
    return_by = datetime.fromisoformat(today["return_by"])
    assert return_by.utcoffset() == timedelta(hours=5, minutes=30)  # on the campus clock
    assert body["curfew_at"] == today["return_by"]  # for app versions that predate `today`
    assert body["curfew"] == return_by.strftime("%H:%M")
    assert "late_until" not in today  # no later-return option: after return_by is late


def test_campus_rules_need_a_signed_in_user(client):
    assert client.get("/campus").status_code == 401


def test_tap_in_closes_a_self_reported_outing(client, db, gate, riya):
    r = client.post("/outings", json={"expected_return_at": soon()}, headers=riya)
    assert r.status_code == 201, r.text
    back = scan(client, riya, kiosk_qr(client, gate["kiosk_token"]))
    assert back.json()["direction"] == "in"
    assert back.json()["outing"]["out_via"] == "self"
    assert back.json()["outing"]["in_via"] == "gate"


def test_a_double_scan_is_ignored(client, db, gate, riya):
    qr = kiosk_qr(client, gate["kiosk_token"])
    assert scan(client, riya, qr, expected_return_at=soon()).status_code == 200
    again = scan(client, riya, qr)
    assert again.status_code == 409
    assert client.get("/outings/current", headers=riya).json() is not None  # still out
    assert scans(db) == [("out", "accepted", True)]  # nothing recorded for the double scan


def test_scanning_needs_an_account(client, gate):
    qr = kiosk_qr(client, gate["kiosk_token"])
    assert client.post("/gates/scan", json={"qr": qr, **AT_GATE}).status_code == 401


# ---------- rejected scans are recorded ----------


def test_tampered_and_garbage_codes_are_rejected(client, db, gate, riya):
    qr = kiosk_qr(client, gate["kiosk_token"])
    tampered = qr[:-1] + ("A" if qr[-1] != "A" else "B")
    r = scan(client, riya, tampered)
    assert r.status_code == 422
    assert "isn't valid" in r.json()["detail"]
    assert scan(client, riya, "https://example.com/not-a-gate").status_code == 422
    assert scans(db) == [("out", "bad_code", True), ("out", "bad_code", False)]
    assert client.get("/outings/current", headers=riya).json() is None


def test_an_old_code_stops_working(client, gate, riya):
    pepper = FAKE_SECRET[::-1]  # the test settings' code_pepper
    gate_id = uuid.UUID(gate["gate"]["id"])
    old = window_at(datetime.now(UTC)) - 3  # current + 2 previous windows are accepted
    web_url = client.app.state.settings.web_url
    qr = qr_payload(web_url, gate_id, old, gate_code(pepper, gate_id, old))
    assert scan(client, riya, qr, expected_return_at=soon()).status_code == 422


def test_a_switched_off_gate_refuses_scans(client, db, admin, gate, riya):
    qr = kiosk_qr(client, gate["kiosk_token"])
    client.patch(f"/admin/gates/{gate['gate']['id']}", json={"active": False}, headers=admin)
    r = scan(client, riya, qr, expected_return_at=soon())
    assert r.status_code == 422
    assert "isn't taking scans" in r.json()["detail"]
    assert scans(db) == [("out", "gate_off", True)]


def test_too_far_from_the_gate(client, db, gate, riya):
    r = scan(client, riya, kiosk_qr(client, gate["kiosk_token"]), north(300))
    assert r.status_code == 422
    assert "about 300 m from Main Gate" in r.json()["detail"]
    distance = db.execute(text("SELECT result, distance_m FROM gate_scans")).one()
    assert distance[0] == "too_far"
    assert 295 < distance[1] < 305


def test_gps_error_counts_in_the_students_favour_up_to_a_cap(client, db, gate, riya):
    qr = kiosk_qr(client, gate["kiosk_token"])
    # 100 m out, radius 75: accuracy 40 m -> allowed (75 + 40 >= 100)
    assert (
        scan(
            client, riya, qr, {**north(100), "accuracy_m": 40}, expected_return_at=soon()
        ).status_code
        == 200
    )
    age_scans(db)
    # 140 m out with 120 m accuracy: the allowance is capped at 50 m (75 + 50 < 140)
    r = scan(client, riya, qr, {**north(140), "accuracy_m": 120})
    assert r.status_code == 422
    assert scans(db)[-1] == ("in", "too_far", True)


def test_weak_and_mocked_locations_are_rejected(client, db, gate, riya):
    qr = kiosk_qr(client, gate["kiosk_token"])
    weak = scan(client, riya, qr, {**AT_GATE, "accuracy_m": 200})
    assert weak.status_code == 422
    assert "precise enough" in weak.json()["detail"]
    mocked = scan(client, riya, qr, mocked=True)
    assert mocked.status_code == 422
    assert "mock location" in mocked.json()["detail"]
    assert [r[1] for r in scans(db)] == ["weak_gps", "mock_gps"]


def test_scans_never_store_coordinates(db):
    columns = {
        r[0]
        for r in db.execute(
            text(
                "SELECT column_name FROM information_schema.columns WHERE table_name = 'gate_scans'"
            )
        )
    }
    assert not columns & {"lat", "lng", "latitude", "longitude", "location"}


# ---------- kiosk ----------


def test_kiosk_shows_the_current_code(client, gate):
    r = client.get("/kiosk/qr", headers={"X-Kiosk-Token": gate["kiosk_token"]})
    assert r.status_code == 200
    body = r.json()
    assert body["gate_name"] == "Main Gate"
    assert body["qr"].startswith(f"{client.app.state.settings.web_url}/g/{gate['gate']['id']}.")
    refresh = datetime.fromisoformat(body["refresh_at"])
    assert datetime.now(UTC) < refresh <= datetime.now(UTC) + timedelta(seconds=21)


def test_kiosk_needs_its_own_token(client, db, admin, gate):
    assert client.get("/kiosk/qr").status_code == 401
    assert client.get("/kiosk/qr", headers={"X-Kiosk-Token": "nope"}).status_code == 401
    stored = db.execute(text("SELECT kiosk_token_hash FROM gates")).scalar_one()
    assert gate["kiosk_token"].encode() not in bytes(stored)  # only the hash is kept


def test_rotating_the_kiosk_token_retires_the_old_one(client, admin, gate):
    r = client.post(f"/admin/gates/{gate['gate']['id']}/kiosk-token", headers=admin)
    assert r.status_code == 200
    new = r.json()["kiosk_token"]
    assert new != gate["kiosk_token"]
    assert (
        client.get("/kiosk/qr", headers={"X-Kiosk-Token": gate["kiosk_token"]}).status_code == 401
    )
    assert client.get("/kiosk/qr", headers={"X-Kiosk-Token": new}).status_code == 200


def test_a_switched_off_kiosk_says_so(client, admin, gate):
    client.patch(f"/admin/gates/{gate['gate']['id']}", json={"active": False}, headers=admin)
    r = client.get("/kiosk/qr", headers={"X-Kiosk-Token": gate["kiosk_token"]})
    assert r.status_code == 423
    assert "switched off" in r.json()["detail"]
