"""Small fixes from security audit run 6, and the owner's 2026-11-08 decision on promoted
students: a search's own % and _ match only themselves, CSV cells can't start a formula after
spaces or a line break, dev push logs carry no message text, a changed email signs the account
out everywhere, and a student promoted to staff leaves their hostel."""

import asyncio
import logging

import pytest
from sqlalchemy import text

from app.push import LogPushSender, PushMessage
from app.security.rate_limit import Limit
from app.services import admin as admin_service
from tests.helpers import login, make_admin, signup
from tests.test_wardens import set_role, student, user_id

TAB, LF, CR = chr(9), chr(10), chr(13)


@pytest.fixture(autouse=True)
def many_sign_ups(monkeypatch):
    monkeypatch.setattr("app.api.auth.REGISTER_PER_IP", Limit(max_hits=100, window_seconds=3600))


@pytest.fixture
def admin(client, db):
    headers = signup(client, "office@geu.ac.in", "Office")[1]
    make_admin(db, "office@geu.ac.in")
    return headers


@pytest.fixture
def hostels(client, admin) -> dict[str, str]:
    default = next(
        r for r in client.get("/admin/rule-sets", headers=admin).json() if r["is_default"]
    )
    ids = {}
    for name in ("A", "B"):
        r = client.post(
            "/admin/hostels",
            json={"name": f"Hostel {name}", "rule_set_id": default["id"]},
            headers=admin,
        )
        assert r.status_code == 201, r.text
        ids[name] = next(h["id"] for h in r.json() if h["name"] == f"Hostel {name}")
    return ids


# ---------- search: % and _ are letters, not wildcards ----------


@pytest.mark.parametrize("path", ["/admin/users", "/admin/students"])
def test_a_search_for_an_underscore_finds_only_the_underscore(client, admin, hostels, path):
    student(client, "ann_a@geu.ac.in", "Ann A", hostels["A"])
    student(client, "annxa@geu.ac.in", "Ann X", hostels["A"])
    found = client.get(path, params={"q": "ann_a"}, headers=admin)
    assert found.status_code == 200, found.text
    assert [p["email"] for p in found.json()] == ["ann_a@geu.ac.in"]
    every = client.get(path, params={"q": "%%"}, headers=admin)
    assert every.status_code == 200 and every.json() == []


# ---------- CSV: no formula after spaces or a line break ----------


@pytest.mark.parametrize(
    "cell",
    ["=1+1", " =1+1", "  +91 98765", " -2", " @SUM(A1)", " |x", " %x", TAB + "x", CR + "x"]
    + [LF + "=1+1", LF + "x"]
    # Spaces, then a line break or tab, then a formula: skipped together by some spreadsheets.
    + [" " + TAB + "=1+1", "  " + CR + "+1", " " + LF + " @x", TAB + " =1"],
)
def test_a_cell_that_could_run_is_shown_as_text(cell):
    assert admin_service._safe(cell) == "'" + cell


@pytest.mark.parametrize("cell", ["Anna", " Anna", "", "Hostel A", "98765 43210"])
def test_a_plain_cell_is_left_alone(cell):
    assert admin_service._safe(cell) == cell


# ---------- dev push log: counts only ----------


def test_the_dev_push_log_keeps_no_message_text(caplog):
    message = PushMessage(title="Help: Anna pressed Help", body="Near Clock Tower")
    with caplog.at_level(logging.INFO, logger="app.push"):
        asyncio.run(LogPushSender().send(["ExponentPushToken[a]", "ExponentPushToken[b]"], message))
    assert "2 device" in caplog.text
    assert "Anna" not in caplog.text and "Clock Tower" not in caplog.text


# ---------- a changed email signs the account out everywhere ----------


def test_a_new_email_signs_the_account_out_everywhere(client, db, admin, hostels):
    student(client, "anna@geu.ac.in", "Anna", hostels["A"])
    tokens = login(client, "anna@geu.ac.in")
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    uid = user_id(client, admin, "anna@geu.ac.in")
    r = client.patch(f"/admin/users/{uid}", json={"email": "anna.r@geu.ac.in"}, headers=admin)
    assert r.status_code == 200, r.text
    refresh = client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert refresh.status_code == 401
    assert client.get("/auth/me", headers=headers).status_code == 401
    office = user_id(client, admin, "office@geu.ac.in")
    rows = db.execute(
        text("SELECT CAST(actor_id AS text), action FROM admin_audit WHERE action = 'account:edit'")
    ).all()
    assert rows == [(office, "account:edit")]


def test_a_name_change_keeps_the_account_signed_in(client, admin, hostels):
    student(client, "anna@geu.ac.in", "Anna", hostels["A"])
    tokens = login(client, "anna@geu.ac.in")
    uid = user_id(client, admin, "anna@geu.ac.in")
    r = client.patch(f"/admin/users/{uid}", json={"name": "Anna Rawat"}, headers=admin)
    assert r.status_code == 200, r.text
    refresh = client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert refresh.status_code == 200


# ---------- a student promoted to staff leaves their hostel ----------


def home(db, email):
    return db.execute(text("SELECT hostel_id FROM users WHERE email = :e"), {"e": email}).scalar()


@pytest.mark.parametrize("role", ["warden", "head_warden", "admin"])
def test_a_promoted_student_leaves_their_hostel(client, db, admin, hostels, role):
    student(client, "ravi@geu.ac.in", "Ravi", hostels["A"])
    assert home(db, "ravi@geu.ac.in") is not None
    wards = [hostels["B"]] if role == "warden" else []
    r = set_role(client, admin, "ravi@geu.ac.in", role, wards)
    assert r.status_code == 200, r.text
    assert home(db, "ravi@geu.ac.in") is None
    listed = client.get("/admin/students", params={"hostel_id": hostels["A"]}, headers=admin)
    assert listed.status_code == 200
    assert "ravi@geu.ac.in" not in [p["email"] for p in listed.json()]


def test_staff_kept_in_a_hostel_from_before_leave_it_when_their_role_is_set(
    client, db, admin, hostels
):
    signup(client, "head@geu.ac.in", "Head")
    assert set_role(client, admin, "head@geu.ac.in", "head_warden").status_code == 200
    db.execute(
        text("UPDATE users SET hostel_id = CAST(:h AS uuid) WHERE email = 'head@geu.ac.in'"),
        {"h": hostels["A"]},
    )
    db.commit()
    assert set_role(client, admin, "head@geu.ac.in", "head_warden").status_code == 200
    assert home(db, "head@geu.ac.in") is None


def test_a_student_role_set_again_keeps_their_hostel(client, db, admin, hostels):
    student(client, "ravi@geu.ac.in", "Ravi", hostels["A"])
    assert set_role(client, admin, "ravi@geu.ac.in", "student").status_code == 200
    assert home(db, "ravi@geu.ac.in") is not None
