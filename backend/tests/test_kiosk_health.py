"""Kiosk health (when each gate's tablet last asked for a code) and kiosk quiet hours (off by
default; while quiet the kiosk is told when it opens and stops asking)."""

from datetime import UTC, datetime, time, timedelta

import pytest
from sqlalchemy import text

from app.models import Gate
from app.services.gates import (
    KIOSK_STALE_AFTER,
    QuietHours,
    kiosk_health,
    note_kiosk_seen,
)
from tests.helpers import create_gate, hhmm, ist_now_minutes, make_admin, signup
from tests.test_view_as import READ_ONLY, as_, make_developer

IST = timedelta(hours=5, minutes=30)


def at_ist(hour: int, minute: int = 0) -> datetime:
    """A UTC instant whose campus-clock time is hour:minute (on 2026-11-08 IST)."""
    return datetime(2026, 11, 8, hour, minute, tzinfo=UTC) - IST


@pytest.fixture
def admin(client, db):
    _, headers = signup(client, "admin@example.com", "Asha Admin")
    make_admin(db, "admin@example.com")
    return headers


@pytest.fixture
def gate(client, admin):
    return create_gate(client, admin)


def poll(client, token: str):
    return client.get("/kiosk/qr", headers={"X-Kiosk-Token": token})


def seen_at(db) -> datetime | None:
    return db.execute(text("SELECT kiosk_seen_at FROM gates")).scalar_one()


def listed(client, headers) -> dict:
    [row] = client.get("/admin/gates", headers=headers).json()
    return row


# ---------- the rules, without a database ----------


@pytest.mark.parametrize(
    ("start", "end", "hour", "quiet"),
    [
        (time(23), time(5), 22, False),
        (time(23), time(5), 23, True),  # the start counts
        (time(23), time(5), 2, True),  # across midnight
        (time(23), time(5), 5, False),  # the end doesn't
        (time(1), time(5), 0, False),
        (time(1), time(5), 3, True),
        (time(1), time(5), 6, False),
    ],
)
def test_quiet_hours_may_cross_midnight(start, end, hour, quiet):
    assert QuietHours(start, end).is_quiet(at_ist(hour)) is quiet


def test_quiet_hours_say_when_the_kiosks_open():
    hours = QuietHours(time(23), time(5, 30))
    # At 23:10 they open tomorrow morning; at 02:00, this morning.
    assert hours.opens_at(at_ist(23, 10)) == at_ist(5, 30) + timedelta(days=1)
    assert hours.opens_at(at_ist(2)) == at_ist(5, 30)
    # They last opened this morning (at 10:00), or yesterday morning (at 02:00).
    assert hours.last_opened(at_ist(10)) == at_ist(5, 30)
    assert hours.last_opened(at_ist(2)) == at_ist(5, 30) - timedelta(days=1)


def test_health_from_the_last_poll():
    now = at_ist(12)
    gate = Gate(name="Main Gate", kiosk_seen_at=None)
    assert kiosk_health(gate, None, now) == "never"
    gate.kiosk_seen_at = now - timedelta(minutes=2)
    assert kiosk_health(gate, None, now) == "ok"
    gate.kiosk_seen_at = now - KIOSK_STALE_AFTER - timedelta(seconds=1)
    assert kiosk_health(gate, None, now) == "stale"
    # Inside quiet hours a silent tablet is expected; just after they end, it gets a moment.
    assert kiosk_health(gate, QuietHours(time(11), time(13)), now) == "quiet"
    assert kiosk_health(gate, QuietHours(time(10), time(11, 58)), now) == "ok"
    assert kiosk_health(gate, QuietHours(time(10), time(11)), now) == "stale"


def test_a_poll_is_written_at_most_once_a_minute():
    now = at_ist(12)
    gate = Gate(name="Main Gate", kiosk_seen_at=None)
    assert note_kiosk_seen(gate, now) is True and gate.kiosk_seen_at == now
    assert note_kiosk_seen(gate, now + timedelta(seconds=59)) is False
    assert gate.kiosk_seen_at == now
    assert note_kiosk_seen(gate, now + timedelta(seconds=60)) is True


# ---------- kiosk health on Admin, Gates ----------


def test_a_kiosk_poll_is_its_sign_of_life(client, db, admin, gate):
    assert listed(client, admin)["kiosk"] == "never"
    assert listed(client, admin)["kiosk_seen_at"] is None
    before = datetime.now(UTC)
    assert poll(client, gate["kiosk_token"]).status_code == 200
    first = seen_at(db)
    assert first is not None and first >= before - timedelta(seconds=1)
    row = listed(client, admin)
    assert row["kiosk"] == "ok" and row["kiosk_seen_at"].endswith("+05:30")
    # The next polls within the minute write nothing.
    assert poll(client, gate["kiosk_token"]).status_code == 200
    assert seen_at(db) == first


def test_a_silent_kiosk_is_stale(client, db, admin, gate):
    poll(client, gate["kiosk_token"])
    db.execute(text("UPDATE gates SET kiosk_seen_at = now() - interval '10 minutes'"))
    db.commit()
    assert listed(client, admin)["kiosk"] == "stale"
    # Polling again (more than a minute later) brings it back.
    poll(client, gate["kiosk_token"])
    assert listed(client, admin)["kiosk"] == "ok"


def test_a_switched_off_gates_tablet_still_counts(client, db, admin, gate):
    client.patch(f"/admin/gates/{gate['gate']['id']}", json={"active": False}, headers=admin)
    assert poll(client, gate["kiosk_token"]).status_code == 423
    assert seen_at(db) is not None


def test_an_unknown_kiosk_records_nothing(client, db, admin, gate):
    assert poll(client, "not-a-kiosk-token-at-all-0000000000000").status_code == 401
    assert seen_at(db) is None


def test_kiosk_health_is_for_admins(client, db, admin, gate):
    """Wardens read gates to filter scans; the tablets' health is for admins."""
    _, warden = signup(client, "warden@example.com", "Wanda Warden")
    db.execute(text("UPDATE users SET role = 'warden' WHERE email = 'warden@example.com'"))
    db.commit()
    poll(client, gate["kiosk_token"])
    row = listed(client, warden)
    assert (row["kiosk"], row["kiosk_seen_at"]) == (None, None)
    assert listed(client, admin)["kiosk"] == "ok"


# ---------- quiet hours ----------


def quiet_around_now(client, admin, *, now_inside: bool) -> dict:
    """Quiet hours that include the current IST minute (or start an hour from now)."""
    now = ist_now_minutes()
    start, end = (now - 60, now + 60) if now_inside else (now + 60, now + 120)
    body = {
        "scan_retention_days": 180,
        "kiosk_quiet_from": hhmm(start % 1440),
        "kiosk_quiet_until": hhmm(end % 1440),
    }
    r = client.put("/admin/settings", json=body, headers=admin)
    assert r.status_code == 200, r.text
    return body


def test_quiet_hours_are_off_by_default(client, admin, gate):
    settings = client.get("/admin/settings", headers=admin).json()
    assert (settings["kiosk_quiet_from"], settings["kiosk_quiet_until"]) == (None, None)
    assert poll(client, gate["kiosk_token"]).status_code == 200


def test_a_quiet_kiosk_is_told_when_it_opens(client, db, admin, gate):
    body = quiet_around_now(client, admin, now_inside=True)
    r = poll(client, gate["kiosk_token"])
    assert r.status_code == 423
    answer = r.json()
    assert answer["quiet"] is True
    opens = datetime.fromisoformat(answer["opens_at"])
    assert timedelta(minutes=58) <= opens - datetime.now(UTC) <= timedelta(minutes=61)
    # Older kiosk pages show `detail` (and check back every 30 s).
    assert answer["detail"] == f"Main Gate opens at {body['kiosk_quiet_until']}"
    assert "qr" not in answer
    # Still a sign of life, and the admin sees "quiet", not a warning.
    assert seen_at(db) is not None
    assert listed(client, admin)["kiosk"] == "quiet"


def test_outside_quiet_hours_the_codes_flow(client, admin, gate):
    quiet_around_now(client, admin, now_inside=False)
    assert poll(client, gate["kiosk_token"]).status_code == 200


def test_quiet_hours_round_trip_and_are_audited(client, db, admin):
    on = {"scan_retention_days": 90, "kiosk_quiet_from": "23:00", "kiosk_quiet_until": "05:30"}
    assert client.put("/admin/settings", json=on, headers=admin).json() == {"curfew": "21:30", **on}
    # A page that doesn't send them leaves them as they are.
    r = client.put("/admin/settings", json={"scan_retention_days": 60}, headers=admin)
    assert (r.json()["kiosk_quiet_from"], r.json()["kiosk_quiet_until"]) == ("23:00", "05:30")
    off = {"scan_retention_days": 60, "kiosk_quiet_from": None, "kiosk_quiet_until": None}
    r = client.put("/admin/settings", json=off, headers=admin)
    assert (r.json()["kiosk_quiet_from"], r.json()["kiosk_quiet_until"]) == (None, None)
    actions = db.execute(text("SELECT target FROM admin_audit ORDER BY id")).scalars().all()
    assert actions == [
        "keep scans 90 d, kiosks quiet 23:00-05:30",
        "keep scans 60 d",
        "keep scans 60 d, kiosks always on",
    ]


@pytest.mark.parametrize(
    "quiet",
    [
        {"kiosk_quiet_from": "23:00"},  # one without the other
        {"kiosk_quiet_until": "05:00"},
        {"kiosk_quiet_from": "23:00", "kiosk_quiet_until": None},
        {"kiosk_quiet_from": "23:00", "kiosk_quiet_until": "23:00"},  # no window at all
        {"kiosk_quiet_from": "24:00", "kiosk_quiet_until": "05:00"},
        {"kiosk_quiet_from": "11 PM", "kiosk_quiet_until": "05:00"},
    ],
)
def test_quiet_hours_must_be_a_real_window(client, admin, quiet):
    r = client.put("/admin/settings", json={"scan_retention_days": 90, **quiet}, headers=admin)
    assert r.status_code == 422, r.text


def test_only_admins_set_quiet_hours(client, db, admin):
    body = {"scan_retention_days": 90, "kiosk_quiet_from": "23:00", "kiosk_quiet_until": "05:00"}
    _, student = signup(client, "riya@example.com", "Riya")
    assert client.put("/admin/settings", json=body, headers=student).status_code == 403
    _, warden = signup(client, "warden@example.com", "Wanda Warden")
    db.execute(text("UPDATE users SET role = 'head_warden' WHERE email = 'warden@example.com'"))
    db.commit()
    assert client.put("/admin/settings", json=body, headers=warden).status_code == 403
    _, dev = signup(client, "dev@example.com", "Dev Eloper")
    make_developer(db, "dev@example.com")
    r = client.put("/admin/settings", json=body, headers=as_(dev, "admin"))
    assert (r.status_code, r.json()["detail"]) == (403, READ_ONLY)
    settings = client.get("/admin/settings", headers=admin).json()
    assert settings["kiosk_quiet_from"] is None
