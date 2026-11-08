"""Admin area: only admins get in, they see the register (not locations), changes are audited."""

import csv
import importlib.util
import io
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import text

from tests.helpers import create_gate, ist_now_minutes, kiosk_qr, make_admin, signup

AT_GATE = {"lat": 30.2683, "lng": 77.9950, "accuracy_m": 8}


def soon(hours: float = 2) -> str:
    return (datetime.now(UTC) + timedelta(hours=hours)).isoformat()


@pytest.fixture
def warden(client, db):
    user, headers = signup(client, "warden@example.com", "Warden")
    make_admin(db, "warden@example.com")
    return user, headers


@pytest.fixture
def admin(warden):
    return warden[1]


@pytest.fixture
def riya(client):
    return signup(client, "riya@example.com", "Riya")


def audit(db) -> list[tuple]:
    return [
        tuple(r) for r in db.execute(text("SELECT action, target FROM admin_audit ORDER BY id"))
    ]


ADMIN_GETS = [
    "/admin/overview",
    "/admin/outings",
    "/admin/outings.csv?from=2026-10-01&to=2026-10-02",
    "/admin/scans",
    "/admin/gates",
    "/admin/settings",
    "/admin/users?q=ri",
    "/admin/audit",
]


@pytest.mark.parametrize("path", ADMIN_GETS)
def test_students_are_kept_out(client, riya, path):
    assert client.get(path, headers=riya[1]).status_code == 403
    assert client.get(path).status_code == 401


def test_students_cannot_change_anything(client, riya):
    _, headers = riya
    assert (
        client.post(
            "/admin/gates", json={"name": "X", "lat": 1, "lng": 1}, headers=headers
        ).status_code
        == 403
    )
    assert (
        client.put(
            "/admin/settings", json={"curfew": "22:00", "scan_retention_days": 30}, headers=headers
        ).status_code
        == 403
    )
    r = client.post(f"/admin/users/{riya[0]['id']}/role", json={"role": "admin"}, headers=headers)
    assert r.status_code == 403


def test_me_reports_the_role(client, admin, riya):
    assert client.get("/auth/me", headers=admin).json()["role"] == "admin"
    assert client.get("/auth/me", headers=riya[1]).json()["role"] == "student"


# ---------- register ----------


def test_overview_and_who_is_out(client, db, admin, riya):
    gate = create_gate(client, admin)
    _, arjun = signup(client, "arjun@example.com", "Arjun")
    r = client.post(
        "/gates/scan",
        json={"qr": kiosk_qr(client, gate["kiosk_token"]), **AT_GATE, "expected_return_at": soon()},
        headers=riya[1],
    )
    assert r.status_code == 200, r.text
    client.post("/outings", json={"expected_return_at": soon()}, headers=arjun)
    db.execute(
        text(
            "UPDATE outings SET left_at = now() - interval '3 hours', "
            "expected_return_at = now() - interval '45 minutes' "
            "WHERE student_id = (SELECT id FROM users WHERE email = 'arjun@example.com')"
        )
    )
    db.commit()
    client.post("/gates/scan", json={"qr": "garbage", **AT_GATE}, headers=arjun)  # rejected

    overview = client.get("/admin/overview", headers=admin).json()
    assert overview == {
        "out_now": 1,
        "overdue": 1,
        "scans_today": 1,
        "rejected_today": 1,
        "active_gates": 1,
        "pending_requests": 0,
        "open_escalations": 0,
        "corrections": 0,
        "open_help": 0,
    }

    everyone = client.get("/admin/outings", headers=admin).json()
    assert [o["name"] for o in everyone] == ["Arjun", "Riya"]  # most urgent first
    arjun_row, riya_row = everyone
    assert (arjun_row["status"], arjun_row["out_via"], arjun_row["out_gate"]) == (
        "overdue",
        "self",
        None,
    )
    assert 44 <= arjun_row["late_minutes"] <= 46
    assert (riya_row["status"], riya_row["out_via"], riya_row["out_gate"]) == (
        "out",
        "gate",
        "Main Gate",
    )
    assert riya_row["left_at"].endswith("+05:30")  # shown in IST
    assert "lat" not in riya_row and "location" not in riya_row

    assert [
        o["name"] for o in client.get("/admin/outings?state=overdue", headers=admin).json()
    ] == ["Arjun"]
    assert [o["name"] for o in client.get("/admin/outings?state=out", headers=admin).json()] == [
        "Riya"
    ]


def test_scan_log_pages_newest_first(client, admin, riya):
    for _ in range(5):
        client.post("/gates/scan", json={"qr": "garbage", **AT_GATE}, headers=riya[1])
    first = client.get("/admin/scans?limit=2", headers=admin).json()
    assert len(first["items"]) == 2
    assert first["items"][0]["id"] > first["items"][1]["id"]
    assert first["items"][0]["result"] == "bad_code"
    second = client.get(f"/admin/scans?limit=2&before={first['next_before']}", headers=admin).json()
    third = client.get(f"/admin/scans?limit=2&before={second['next_before']}", headers=admin).json()
    ids = [s["id"] for page in (first, second, third) for s in page["items"]]
    assert len(ids) == len(set(ids)) == 5
    assert third["next_before"] is None
    accepted = client.get("/admin/scans?result=accepted", headers=admin).json()
    assert accepted["items"] == []


def test_csv_export(client, db, admin, riya):
    client.post(
        "/outings",
        json={"expected_return_at": soon(), "destination": '=HYPERLINK("http://x")'},
        headers=riya[1],
    )
    today = (datetime.now(UTC) + timedelta(hours=5, minutes=30)).date()
    r = client.get(f"/admin/outings.csv?from={today}&to={today}", headers=admin)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    assert f'filename="outings-{today}-to-{today}.csv"' in r.headers["content-disposition"]
    # A byte order mark first, so Excel reads the file as UTF-8.
    assert r.content.startswith(b"\xef\xbb\xbf")
    rows = read_csv(r)
    assert rows[0] == [
        "Student",
        "Roll number",
        "Hostel",
        "Email",
        "Destination",
        "Left (IST)",
        "Left through",
        "Due back (IST)",
        "Back (IST)",
        "Came back through",
        "Status",
        "Minutes late",
        "Approved form",
    ]
    assert len(rows) == 2
    row = dict(zip(rows[0], rows[1], strict=True))
    assert (row["Student"], row["Email"]) == ("Riya", "riya@example.com")
    assert row["Destination"].startswith("'=")  # a spreadsheet won't run it as a formula
    assert row["Left through"] == "App or website"
    assert (row["Back (IST)"], row["Came back through"], row["Status"]) == ("", "", "Out")
    assert row["Approved form"] == "No"

    yesterday = today - timedelta(days=1)
    empty = client.get(f"/admin/outings.csv?from={yesterday}&to={yesterday}", headers=admin)
    assert len(read_csv(empty)) == 1


def read_csv(response) -> list[list[str]]:
    """The download's rows, without the byte order mark that leads the file."""
    return list(csv.reader(io.StringIO(response.content.decode("utf-8-sig"))))


def test_csv_names_the_hostel_gates_and_how_trips_ended(client, db, admin, riya):
    """Management reads it without a key: the hostel at the time, gates and how each trip ended
    in words, IST times, and the roll number."""
    gate = create_gate(client, admin)
    db.execute(
        text(
            "INSERT INTO hostels (name, rule_set_id) SELECT 'Ganga', id FROM rule_sets LIMIT 1; "
            "UPDATE users SET roll_no = '2510370', "
            "hostel_id = (SELECT id FROM hostels WHERE name = 'Ganga') "
            "WHERE email = 'riya@example.com'"
        )
    )
    db.commit()
    scan = {"qr": kiosk_qr(client, gate["kiosk_token"]), **AT_GATE}
    assert client.post("/gates/scan", json=scan, headers=riya[1]).status_code == 200
    db.execute(
        text(
            "UPDATE outings SET left_at = now() - interval '3 hours', "
            "expected_return_at = now() - interval '1 hour'"
        )
    )
    db.commit()
    assert client.post("/outings/current/return", headers=riya[1]).status_code == 200
    _, arjun = signup(client, "arjun@example.com", "Arjun")
    assert client.post("/outings", json={}, headers=arjun).status_code == 201
    today = (datetime.now(UTC) + timedelta(hours=5, minutes=30)).date()
    # From yesterday: three hours ago may have been yesterday on the campus clock.
    r = client.get(f"/admin/outings.csv?from={today - timedelta(days=1)}&to={today}", headers=admin)
    header, *lines = read_csv(r)
    rows = {line[0]: dict(zip(header, line, strict=True)) for line in lines}
    riya_row = rows["Riya"]
    assert (riya_row["Roll number"], riya_row["Hostel"]) == ("2510370", "Ganga")
    assert riya_row["Left through"] == "Gate scan at Main Gate"
    assert riya_row["Came back through"] == "App or website"
    assert riya_row["Status"] == "Back late"
    assert 59 <= int(riya_row["Minutes late"]) <= 61
    # IST wall-clock times, to the minute.
    left = datetime.strptime(riya_row["Left (IST)"], "%Y-%m-%d %H:%M")
    expected = (datetime.now(UTC) + timedelta(hours=5, minutes=30) - timedelta(hours=3)).replace(
        tzinfo=None
    )
    assert abs((left - expected).total_seconds()) < 120
    assert (rows["Arjun"]["Hostel"], rows["Arjun"]["Status"]) == ("", "Out")


@pytest.mark.parametrize(
    ("start", "end"),
    [
        ("2026-10-02", "2026-10-01"),
        ("2026-01-01", "2026-06-01"),
        # The ends of the calendar used to overflow into a 500.
        ("0001-01-01", "0001-01-02"),
        ("9999-12-30", "9999-12-31"),
    ],
)
def test_csv_export_range_is_bounded(client, admin, start, end):
    assert client.get(f"/admin/outings.csv?from={start}&to={end}", headers=admin).status_code == 422


# ---------- gates & settings ----------


def test_gates_crud_is_audited(client, db, admin):
    created = create_gate(client, admin)
    gate_id = created["gate"]["id"]
    assert created["gate"]["radius_m"] == 75 and created["gate"]["active"] is True
    assert len(created["kiosk_token"]) >= 32

    dup = client.post("/admin/gates", json={"name": "Main Gate", "lat": 1, "lng": 1}, headers=admin)
    assert dup.status_code == 409

    patched = client.patch(
        f"/admin/gates/{gate_id}", json={"radius_m": 120, "active": False}, headers=admin
    )
    assert patched.status_code == 200
    assert (patched.json()["radius_m"], patched.json()["active"]) == (120, False)
    assert "kiosk_token" not in patched.json()

    listed = client.get("/admin/gates", headers=admin).json()
    assert [g["name"] for g in listed] == ["Main Gate"]
    assert "kiosk_token_hash" not in listed[0]
    assert (
        client.patch(
            "/admin/gates/00000000-0000-0000-0000-000000000000", json={}, headers=admin
        ).status_code
        == 404
    )

    client.post(f"/admin/gates/{gate_id}/kiosk-token", headers=admin)
    assert audit(db) == [
        ("gate:create", "Main Gate"),
        ("gate:update", "Main Gate: active, radius_m"),
        ("gate:kiosk-token", "Main Gate"),
    ]


def test_only_an_unused_gate_can_be_removed(client, db, admin):
    spare_created = create_gate(client, admin, name="Test Gate")
    spare = spare_created["gate"]
    main = create_gate(client, admin)
    assert spare["used"] is False
    _, riya = signup(client, "riya@example.com", "Riya")
    qr = kiosk_qr(client, main["kiosk_token"])
    # Even a refused scan (too far away) names the gate, so it stays for the records.
    far = client.post(
        "/gates/scan", json={"qr": qr, "lat": 0, "lng": 0, "accuracy_m": 8}, headers=riya
    )
    assert far.status_code == 422, far.text
    listed = {g["name"]: g["used"] for g in client.get("/admin/gates", headers=admin).json()}
    assert listed == {"Main Gate": True, "Test Gate": False}

    main_id = main["gate"]["id"]
    refused = client.delete(f"/admin/gates/{main_id}", headers=admin)
    assert refused.status_code == 409
    assert "Switch it off instead" in refused.json()["detail"]
    patched = client.patch(f"/admin/gates/{main_id}", json={"active": False}, headers=admin)
    assert patched.json()["used"] is True  # every gate answer says so, not just the list

    assert client.delete(f"/admin/gates/{spare['id']}", headers=riya).status_code == 403
    assert client.delete(f"/admin/gates/{spare['id']}", headers=admin).status_code == 204
    assert client.delete(f"/admin/gates/{spare['id']}", headers=admin).status_code == 404
    assert [g["name"] for g in client.get("/admin/gates", headers=admin).json()] == ["Main Gate"]
    assert ("gate:remove", "Test Gate") in audit(db)
    # The removed gate's kiosk link is dead too.
    kiosk = client.get("/kiosk/qr", headers={"X-Kiosk-Token": spare_created["kiosk_token"]})
    assert kiosk.status_code == 401


def test_settings_round_trip(client, db, admin):
    quiet_off = {
        "kiosk_quiet_from": None,
        "kiosk_quiet_until": None,
        # Alert timings (wave 2): unchanged here, tested in test_alerts.py.
        "request_remind_minutes": 15,
        "request_backup_minutes": 30,
        "escalation_realert_minutes": 15,
        "escalation_takeover_minutes": 30,
    }
    assert client.get("/admin/settings", headers=admin).json() == {
        "curfew": "21:30",
        "scan_retention_days": 180,
        **quiet_off,
    }
    new = {"curfew": "22:15", "scan_retention_days": 90}
    assert client.put("/admin/settings", json=new, headers=admin).json() == {**new, **quiet_off}
    assert client.get("/admin/settings", headers=admin).json() == {**new, **quiet_off}
    assert audit(db) == [("settings", "keep scans 90 d")]
    # The settings page no longer sends the curfew (rule sets replaced it): it stays as it was.
    r = client.put("/admin/settings", json={"scan_retention_days": 60}, headers=admin)
    assert r.json() == {"curfew": "22:15", "scan_retention_days": 60, **quiet_off}
    for bad in (
        {"curfew": "24:00", "scan_retention_days": 90},
        {"curfew": "22:00", "scan_retention_days": 1},
    ):
        assert client.put("/admin/settings", json=bad, headers=admin).status_code == 422


# ---------- people ----------


def test_search_finds_verified_users_only(client, admin, riya):
    signup(client, "rishi@example.com", "Rishi")
    client.post(
        "/auth/register",
        json={"name": "Rina", "email": "rina@example.com", "password": "correct-horse-battery"},
    )  # never verified
    names = [u["name"] for u in client.get("/admin/users?q=RI", headers=admin).json()]
    assert sorted(names) == ["Rishi", "Riya"]
    by_email = client.get("/admin/users?q=riya@exa", headers=admin).json()
    assert [u["role"] for u in by_email] == ["student"]
    assert client.get("/admin/users?q=r", headers=admin).status_code == 422


def test_promote_and_demote(client, db, warden, riya):
    me, admin = warden
    promoted = client.post(
        f"/admin/users/{riya[0]['id']}/role", json={"role": "admin"}, headers=admin
    )
    assert promoted.status_code == 200
    assert promoted.json()["role"] == "admin"
    assert client.get("/admin/overview", headers=riya[1]).status_code == 200  # takes effect at once

    demoted = client.post(
        f"/admin/users/{me['id']}/role", json={"role": "student"}, headers=riya[1]
    )
    assert demoted.status_code == 200
    assert client.get("/admin/overview", headers=admin).status_code == 403
    assert audit(db) == [("role:admin", "riya@example.com"), ("role:student", "warden@example.com")]


def test_the_last_admin_cannot_be_demoted(client, db, warden):
    me, admin = warden
    r = client.post(f"/admin/users/{me['id']}/role", json={"role": "student"}, headers=admin)
    assert r.status_code == 409
    assert "someone else" in r.json()["detail"]
    assert client.get("/admin/overview", headers=admin).status_code == 200
    assert audit(db) == []


def test_role_change_for_unknown_user(client, admin):
    r = client.post(
        "/admin/users/00000000-0000-0000-0000-000000000000/role",
        json={"role": "admin"},
        headers=admin,
    )
    assert r.status_code == 404


def test_bootstrap_script_makes_the_first_admin(client, test_db_url):
    spec = importlib.util.spec_from_file_location(
        "make_admin", Path(__file__).resolve().parents[1] / "scripts" / "make_admin.py"
    )
    script = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(script)

    _, riya = signup(client, "riya@example.com", "Riya")
    client.post(
        "/auth/register",
        json={"name": "Rina", "email": "rina@example.com", "password": "correct-horse-battery"},
    )
    assert "No account" in script.make_admin(test_db_url, "nobody@example.com")
    assert "No account" in script.make_admin(test_db_url, "rina@example.com")  # still pending
    assert client.get("/admin/overview", headers=riya).status_code == 403
    assert script.make_admin(test_db_url, "riya@example.com") == "riya@example.com is now an admin."
    assert client.get("/admin/overview", headers=riya).status_code == 200
    assert "already" in script.make_admin(test_db_url, "riya@example.com")


def test_late_today_lists_latecomers_back_or_still_out(client, db, admin):
    # "Today" is the IST day, so both returns must have been due since IST midnight: 20 and 50
    # minutes ago normally, closer together just after midnight (still out = most late).
    since_midnight = ist_now_minutes()
    if since_midnight < 3:
        pytest.skip("too soon after midnight IST for two returns due earlier today")
    back_mins = 20 if since_midnight > 51 else max(1, (since_midnight - 1) // 3)
    out_mins = 50 if since_midnight > 51 else 2 * back_mins

    def student(email: str, name: str) -> dict:
        headers = signup(client, email, name)[1]
        assert client.post("/outings", json={}, headers=headers).status_code == 201
        return headers

    on_time = student("ontime@example.com", "Ontime")
    back_late = student("backlate@example.com", "Backlate")
    still_out = student("stillout@example.com", "Stillout")
    client.post("/outings/current/return", headers=on_time)
    for email, minutes in (("backlate@example.com", back_mins), ("stillout@example.com", out_mins)):
        db.execute(
            text(
                "UPDATE outings SET left_at = now() - interval '2 hours', "
                "expected_return_at = now() - make_interval(mins => :m) "
                "WHERE student_id = (SELECT id FROM users WHERE email = :e)"
            ),
            {"m": minutes, "e": email},
        )
    db.commit()
    client.post("/outings/current/return", headers=back_late)  # back_mins after its return time

    late = client.get("/admin/late-today", headers=admin).json()
    assert [(r["name"], r["status"]) for r in late] == [
        ("Stillout", "overdue"),  # most late first
        ("Backlate", "returned"),
    ]
    assert back_mins - 1 <= late[1]["late_minutes"] <= back_mins + 1
    assert late[1]["returned_at"] is not None
    assert client.get("/admin/late-today", headers=still_out).status_code == 403


def test_csv_export_neutralises_every_typed_cell(client, db, admin, riya):
    """Names and roll numbers are typed by students too, and gate names by admins."""
    db.execute(
        text("UPDATE users SET name = :n, roll_no = :r WHERE email = 'riya@example.com'"),
        {"n": '=HYPERLINK("http://x","Riya")', "r": "+2510370"},
    )
    db.commit()
    client.post(
        "/outings", json={"expected_return_at": soon(), "destination": "|cmd"}, headers=riya[1]
    )
    today = (datetime.now(UTC) + timedelta(hours=5, minutes=30)).date()
    db.execute(
        text(
            "INSERT INTO hostels (name, rule_set_id) SELECT '@Ganga', id FROM rule_sets LIMIT 1; "
            "UPDATE outings SET hostel_id = (SELECT id FROM hostels WHERE name = '@Ganga')"
        )
    )
    db.commit()
    rows = read_csv(client.get(f"/admin/outings.csv?from={today}&to={today}", headers=admin))
    name, roll_no, hostel, email, destination, *_rest = rows[1]
    assert name == """'=HYPERLINK("http://x","Riya")"""
    assert (email, roll_no, destination) == ("riya@example.com", "'+2510370", "'|cmd")
    assert hostel == "'@Ganga"


@pytest.mark.parametrize(
    ("cell", "safe"),
    [
        ("%Riya", "'%Riya"),
        ("@SUM(A1)", "'@SUM(A1)"),
        ("-1", "'-1"),
        ("+91", "'+91"),
        ("=1+1", "'=1+1"),
        (chr(9) + "=1", "'" + chr(9) + "=1"),  # a tab
        (chr(13) + "=1", "'" + chr(13) + "=1"),  # a carriage return
        ("Riya", "Riya"),
        ("", ""),
    ],
)
def test_formula_guard(cell, safe):
    from app.services.admin import _safe

    assert _safe(cell) == safe
