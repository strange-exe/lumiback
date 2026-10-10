"""Admin area: only admins get in, they see the register (not locations), changes are audited."""

import csv
import importlib.util
import io
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import text

from tests.helpers import create_gate, kiosk_qr, make_admin, signup

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
    rows = list(csv.reader(io.StringIO(r.text)))
    assert rows[0][:4] == ["Name", "Email", "Roll no.", "Destination"]
    assert len(rows) == 2
    name, email, _, destination, *_rest = rows[1]
    assert (name, email) == ("Riya", "riya@example.com")
    assert destination.startswith("'=")  # a spreadsheet won't run it as a formula
    assert rows[1][5] == "self"

    yesterday = today - timedelta(days=1)
    empty = client.get(f"/admin/outings.csv?from={yesterday}&to={yesterday}", headers=admin)
    assert len(list(csv.reader(io.StringIO(empty.text)))) == 1


@pytest.mark.parametrize(
    ("start", "end"), [("2026-10-02", "2026-10-01"), ("2026-01-01", "2026-06-01")]
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


def test_settings_round_trip(client, db, admin):
    assert client.get("/admin/settings", headers=admin).json() == {
        "curfew": "21:30",
        "scan_retention_days": 180,
    }
    new = {"curfew": "22:15", "scan_retention_days": 90}
    assert client.put("/admin/settings", json=new, headers=admin).json() == new
    assert client.get("/admin/settings", headers=admin).json() == new
    assert audit(db) == [("settings", "keep scans 90 d")]
    # The settings page no longer sends the curfew (rule sets replaced it): it stays as it was.
    r = client.put("/admin/settings", json={"scan_retention_days": 60}, headers=admin)
    assert r.json() == {"curfew": "22:15", "scan_retention_days": 60}
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
    def student(email: str, name: str) -> dict:
        headers = signup(client, email, name)[1]
        assert client.post("/outings", json={}, headers=headers).status_code == 201
        return headers

    on_time = student("ontime@example.com", "Ontime")
    back_late = student("backlate@example.com", "Backlate")
    still_out = student("stillout@example.com", "Stillout")
    client.post("/outings/current/return", headers=on_time)
    for email, minutes in (("backlate@example.com", 20), ("stillout@example.com", 50)):
        db.execute(
            text(
                "UPDATE outings SET left_at = now() - interval '2 hours', "
                "expected_return_at = now() - make_interval(mins => :m) "
                "WHERE student_id = (SELECT id FROM users WHERE email = :e)"
            ),
            {"m": minutes, "e": email},
        )
    db.commit()
    client.post("/outings/current/return", headers=back_late)  # 20 min after its return time

    late = client.get("/admin/late-today", headers=admin).json()
    assert [(r["name"], r["status"]) for r in late] == [
        ("Stillout", "overdue"),  # most late first
        ("Backlate", "returned"),
    ]
    assert 19 <= late[1]["late_minutes"] <= 21 and late[1]["returned_at"] is not None
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
    rows = list(
        csv.reader(
            io.StringIO(
                client.get(f"/admin/outings.csv?from={today}&to={today}", headers=admin).text
            )
        )
    )
    name, email, roll_no, destination, *_rest = rows[1]
    assert name == """'=HYPERLINK("http://x","Riya")"""
    assert (email, roll_no, destination) == ("riya@example.com", "'+2510370", "'|cmd")


@pytest.mark.parametrize(
    ("cell", "safe"),
    [("%Riya", "'%Riya"), ("@SUM(A1)", "'@SUM(A1)"), ("-1", "'-1"), ("Riya", "Riya"), ("", "")],
)
def test_formula_guard(cell, safe):
    from app.services.admin import _safe

    assert _safe(cell) == safe
