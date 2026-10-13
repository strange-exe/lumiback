"""Wardens: the hostel office for the hostels an admin assigns, and nothing outside them.

Two hostels, a student in each. The warden of Hostel A must never see, approve or resolve
anything for the Hostel B student, and campus-wide setup stays admin-only.
"""

import csv
import io
from datetime import UTC, datetime

import pytest
from sqlalchemy import text

from app.jobs.expiry import sweep
from app.push import MemoryPushSender
from tests.helpers import make_admin, set_rules, signup

FORM = {
    "purpose": "Shopping at Pacific Mall",
    "phone": "98765 43210",
    "emergency_name": "Sunita Sharma",
    "emergency_relation": "Mother",
    "emergency_phone": "+91-91234-56789",
}
WARDEN_PHONE = "ExponentPushToken[wardenAphone01]"
ADMIN_PHONE = "ExponentPushToken[adminPhone0001]"


@pytest.fixture
def push(client) -> MemoryPushSender:
    sender = MemoryPushSender()
    client.app.state.push = sender
    return sender


@pytest.fixture
def admin(client, db):
    headers = signup(client, "office@geu.ac.in", "Office")[1]
    make_admin(db, "office@geu.ac.in")
    return headers


@pytest.fixture
def hostels(client, admin) -> dict[str, str]:
    """{"A": id, "B": id}, both on the default rules."""
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


def student(client, email: str, name: str, hostel_id: str) -> dict:
    headers = signup(client, email, name)[1]
    r = client.patch("/profile", json={"hostel_id": hostel_id}, headers=headers)
    assert r.status_code == 200, r.text
    return headers


@pytest.fixture
def anna(client, hostels):
    return student(client, "anna@geu.ac.in", "Anna", hostels["A"])


@pytest.fixture
def bina(client, hostels):
    return student(client, "bina@geu.ac.in", "Bina", hostels["B"])


def user_id(client, admin, email: str) -> str:
    return client.get("/admin/users", params={"q": email}, headers=admin).json()[0]["id"]


def set_role(client, admin, email: str, role: str, hostel_ids=()):
    return client.post(
        f"/admin/users/{user_id(client, admin, email)}/role",
        json={"role": role, "hostel_ids": list(hostel_ids)},
        headers=admin,
    )


@pytest.fixture
def warden(client, admin, hostels):
    """Warden of Hostel A only."""
    headers = signup(client, "warden.a@geu.ac.in", "Warden A")[1]
    r = set_role(client, admin, "warden.a@geu.ac.in", "warden", [hostels["A"]])
    assert r.status_code == 200, r.text
    return headers


def register_token(client, headers, token):
    r = client.post(
        "/devices/push-token", json={"token": token, "platform": "android"}, headers=headers
    )
    assert r.status_code == 204, r.text


def go_out(client, headers):
    r = client.post("/outings", json={"destination": "Rajpur Road"}, headers=headers)
    assert r.status_code == 201, r.text


# ---------- roles ----------


def test_an_admin_makes_a_warden_of_some_hostels(client, admin, hostels, warden):
    found = client.get("/admin/users", params={"q": "warden.a"}, headers=admin).json()
    assert [(p["role"], p["hostels"], p["hostel_ids"]) for p in found] == [
        ("warden", ["Hostel A"], [hostels["A"]])
    ]
    me = client.get("/auth/me", headers=warden).json()
    assert me["role"] == "warden"


def test_a_warden_needs_a_real_hostel(client, admin, hostels):
    signup(client, "w@geu.ac.in", "W")
    for ids in ([], ["00000000-0000-0000-0000-000000000000"]):
        r = set_role(client, admin, "w@geu.ac.in", "warden", ids)
        assert (
            r.status_code == 422 and r.json()["detail"] == "Choose at least one hostel for a warden"
        )


def test_changing_role_drops_the_hostels(client, admin, hostels, warden):
    r = set_role(client, admin, "warden.a@geu.ac.in", "student", [hostels["A"]])
    assert r.status_code == 200 and r.json()["hostels"] == []
    assert client.get("/admin/overview", headers=warden).status_code == 403
    # Back to warden of B: A is gone for good.
    set_role(client, admin, "warden.a@geu.ac.in", "warden", [hostels["B"]])
    assert [h["name"] for h in client.get("/admin/my-hostels", headers=warden).json()] == [
        "Hostel B"
    ]


def test_the_last_admin_cant_become_a_warden(client, admin, hostels):
    r = set_role(client, admin, "office@geu.ac.in", "warden", [hostels["A"]])
    assert r.status_code == 409 and r.json()["detail"] == "Make someone else an admin first"


# ---------- what a warden may do ----------


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("post", "/admin/gates", {"name": "X", "lat": 30.0, "lng": 78.0, "radius_m": 75}),
        ("get", "/admin/users?q=anna", None),
        ("get", "/admin/settings", None),
        ("get", "/admin/hostels", None),  # rules setup: admins and head wardens
        ("put", "/admin/holidays/2026-12-25", {"day": "2026-12-25", "name": "Christmas"}),
    ],
)
def test_setup_isnt_for_wardens(client, warden, method, path, body):
    r = client.request(method, path, json=body, headers=warden)
    assert r.status_code == 403
    assert r.json()["detail"] in ("Admins only", "Admins and head wardens only")


def test_a_warden_can_list_gates_to_filter_scans(client, warden, admin):
    client.post(
        "/admin/gates",
        json={"name": "Main Gate", "lat": 30.0, "lng": 78.0, "radius_m": 75},
        headers=admin,
    )
    r = client.get("/admin/gates", headers=warden)
    assert r.status_code == 200 and [g["name"] for g in r.json()] == ["Main Gate"]


def test_a_warden_reads_only_their_hostels_rules(client, admin, warden, hostels):
    # Hostel B moves to a set of its own; the warden of A must not see it.
    default = next(
        r for r in client.get("/admin/rule-sets", headers=admin).json() if r["is_default"]
    )
    days = default["days"]
    other = client.post(
        "/admin/rule-sets", json={"name": "Hostel B rules", "days": days}, headers=admin
    ).json()
    b_set = next(s for s in other if s["name"] == "Hostel B rules")
    client.put(
        f"/admin/hostels/{hostels['B']}",
        json={"name": "Hostel B", "rule_set_id": b_set["id"]},
        headers=admin,
    )
    seen = client.get("/admin/rule-sets", headers=warden).json()
    assert [(s["name"], s["hostels"]) for s in seen] == [(default["name"], ["Hostel A"])]
    assert len(client.get("/admin/rule-sets", headers=admin).json()) >= 2
    assert client.get("/admin/holidays", headers=warden).status_code == 200


def test_a_warden_lists_only_their_hostels_students(client, db, admin, warden, anna, bina, hostels):
    set_rules(db, "open")
    go_out(client, anna)
    people = client.get("/admin/students", headers=warden).json()
    assert [(p["name"], p["hostel"], p["status"]) for p in people] == [("Anna", "Hostel A", "out")]
    assert (
        client.get(f"/admin/students?hostel_id={hostels['B']}", headers=warden).status_code == 404
    )
    assert [p["name"] for p in client.get("/admin/students?q=bina", headers=warden).json()] == []
    everyone = client.get("/admin/students", headers=admin).json()
    assert sorted(p["name"] for p in everyone) == ["Anna", "Bina"]
    found = client.get("/admin/students?q=warden", headers=admin).json()
    assert [(p["name"], p["role"]) for p in found] == [("Warden A", "warden")]


def test_students_cant_use_the_office(client, anna):
    for path in ("/admin/overview", "/admin/requests", "/admin/escalations", "/admin/my-hostels"):
        r = client.get(path, headers=anna)
        assert r.status_code == 403 and r.json()["detail"] == "Hostel office only"


def test_the_register_shows_only_the_wardens_hostels(client, db, admin, warden, anna, bina):
    set_rules(db, "open")
    go_out(client, anna)
    go_out(client, bina)
    db.execute(
        text(
            "INSERT INTO gate_scans (user_id, direction, result) "
            "SELECT id, 'out', 'accepted' FROM users "
            "WHERE email IN ('anna@geu.ac.in', 'bina@geu.ac.in')"
        )
    )
    db.commit()

    names = lambda path, who: sorted(r["name"] for r in client.get(path, headers=who).json())  # noqa: E731
    assert names("/admin/outings", warden) == ["Anna"]
    assert names("/admin/outings", admin) == ["Anna", "Bina"]
    assert client.get("/admin/overview", headers=warden).json()["out_now"] == 1
    assert client.get("/admin/overview", headers=admin).json()["out_now"] == 2
    scans = client.get("/admin/scans", headers=warden).json()["items"]
    assert [s["name"] for s in scans] == ["Anna"]

    today = datetime.now(UTC).date().isoformat()
    r = client.get("/admin/outings.csv", params={"from": today, "to": today}, headers=warden)
    rows = list(csv.reader(io.StringIO(r.text)))[1:]
    assert [row[0] for row in rows] == ["Anna"]


def test_a_warden_moves_only_their_own_students_into_their_own_hostels(
    client, admin, warden, anna, bina, hostels
):
    move = lambda student, hostel: client.post(  # noqa: E731
        f"/admin/students/{user_id(client, admin, student)}/hostel",
        json={"hostel_id": hostels[hostel]},
        headers=warden,
    )
    assert move("bina@geu.ac.in", "A").status_code == 404  # not theirs: as if she didn't exist
    assert move("anna@geu.ac.in", "B").status_code == 403  # B isn't theirs to fill
    assert move("anna@geu.ac.in", "A").status_code == 200  # already there: nothing to do
    # An admin moves anyone anywhere, and it's audited.
    r = client.post(
        f"/admin/students/{user_id(client, admin, 'bina@geu.ac.in')}/hostel",
        json={"hostel_id": hostels["A"]},
        headers=admin,
    )
    assert r.status_code == 200 and r.json()["hostel"] == "Hostel A"


def test_records_stay_with_the_hostel_the_outing_happened_in(
    client, db, admin, warden, anna, hostels
):
    go_out(client, anna)
    client.post("/outings/current/return", headers=anna)
    r = client.post(
        f"/admin/students/{user_id(client, admin, 'anna@geu.ac.in')}/hostel",
        json={"hostel_id": hostels["B"]},
        headers=admin,
    )
    assert r.status_code == 200, r.text
    # Anna lives in B now, but the outing she took from A stays in A's register.
    today = datetime.now(UTC).date().isoformat()
    r = client.get("/admin/outings.csv", params={"from": today, "to": today}, headers=warden)
    assert [row[0] for row in list(csv.reader(io.StringIO(r.text)))[1:]] == ["Anna"]
    # ...and she's no longer one of A's students.
    assert client.get("/admin/students", headers=warden).json() == []


def test_a_warden_decides_only_their_hostels_requests(client, db, admin, warden, anna, bina):
    set_rules(db, "open", max_minutes=180, needs_form=True)
    a = client.post("/outings/request", json=FORM, headers=anna).json()
    b = client.post("/outings/request", json=FORM, headers=bina).json()
    queue = client.get("/admin/requests", headers=warden).json()
    assert [q["name"] for q in queue] == ["Anna"]

    decide = lambda r: client.post(  # noqa: E731
        f"/admin/requests/{r['id']}/decision", json={"approve": True}, headers=warden
    )
    assert decide(b).status_code == 404  # another hostel's: as if it didn't exist
    assert decide(a).status_code == 200
    assert client.get("/outings/request", headers=bina).json()["status"] == "pending"


def test_a_new_request_reaches_the_hostels_wardens(client, db, push, admin, warden, anna, bina):
    set_rules(db, "open", max_minutes=180, needs_form=True)
    register_token(client, warden, WARDEN_PHONE)
    register_token(client, admin, ADMIN_PHONE)
    client.post("/outings/request", json=FORM, headers=anna)
    assert [(t, m.title, m.body, m.url) for t, m in push.outbox] == [
        ([WARDEN_PHONE], "New outing request", "Anna asked for today's outing.", "/office/requests")
    ]
    push.outbox.clear()
    client.post("/outings/request", json=FORM, headers=bina)  # Hostel B has no warden
    assert [t for t, _ in push.outbox] == [[ADMIN_PHONE]]


def run_sweep(client, push):
    state = client.app.state
    return client.portal.call(
        sweep, state.sessionmaker, state.hub, push, state.mailer, "https://lumiback.test"
    )


def test_escalations_go_to_admins_and_the_hostels_wardens(
    client, db, push, admin, warden, anna, bina
):
    set_rules(db, "open")
    register_token(client, warden, WARDEN_PHONE)
    register_token(client, admin, ADMIN_PHONE)
    go_out(client, anna)
    go_out(client, bina)
    db.execute(
        text(
            "UPDATE outings SET left_at = now() - interval '3 hours', "
            "expected_return_at = now() - interval '45 minutes', "
            "overdue_notified_at = now() - interval '11 minutes'"
        )
    )
    db.commit()
    mailer = client.app.state.mailer
    before = len(mailer.outbox)
    assert run_sweep(client, push).escalated == 2

    escalation_pushes = sorted(
        t[0] for t, m in push.outbox if m.title == "A late student needs follow-up"
    )
    assert escalation_pushes == sorted([ADMIN_PHONE, WARDEN_PHONE])
    emails = {e.to: e.body for e in mailer.outbox[before:]}
    assert set(emails) == {"office@geu.ac.in", "warden.a@geu.ac.in"}

    listed = client.get("/admin/escalations", headers=warden).json()
    assert [e["name"] for e in listed] == ["Anna"]
    everyone = client.get("/admin/escalations", headers=admin).json()
    assert sorted(e["name"] for e in everyone) == ["Anna", "Bina"]

    bina_escalation = next(e for e in everyone if e["name"] == "Bina")
    r = client.post(
        f"/admin/escalations/{bina_escalation['id']}/resolve", json={"note": "x"}, headers=warden
    )
    assert r.status_code == 404
    r = client.post(
        f"/admin/escalations/{listed[0]['id']}/resolve", json={"note": "Called"}, headers=warden
    )
    assert r.status_code == 204


def test_a_warden_edits_only_their_hostels_contact(client, warden, hostels):
    r = client.patch(
        f"/admin/hostels/{hostels['A']}/contact",
        json={"warden_name": "Mr Rawat", "warden_phone": "98765 43210"},
        headers=warden,
    )
    assert r.status_code == 200, r.text
    assert [(h["name"], h["warden_name"], h["warden_phone"]) for h in r.json()] == [
        ("Hostel A", "Mr Rawat", "+919876543210")
    ]
    r = client.patch(
        f"/admin/hostels/{hostels['B']}/contact", json={"warden_name": "X"}, headers=warden
    )
    assert r.status_code == 404


# ---------- head wardens: every hostel, and the outing rules ----------


@pytest.fixture
def head(client, admin):
    headers = signup(client, "head@geu.ac.in", "Head Warden")[1]
    r = set_role(client, admin, "head@geu.ac.in", "head_warden")
    assert r.status_code == 200 and r.json()["role"] == "head_warden", r.text
    return headers


def test_a_head_warden_sees_every_hostel_and_edits_rules(
    client, db, admin, head, anna, bina, hostels
):
    set_rules(db, "open")
    go_out(client, anna)
    go_out(client, bina)
    assert sorted(o["name"] for o in client.get("/admin/outings", headers=head).json()) == [
        "Anna",
        "Bina",
    ]
    assert {h["name"] for h in client.get("/admin/my-hostels", headers=head).json()} == {
        "Hostel A",
        "Hostel B",
    }
    # Rules, holidays and which rules a hostel follows.
    sets = client.get("/admin/rule-sets", headers=head).json()
    default = next(s for s in sets if s["is_default"])
    r = client.put(
        f"/admin/rule-sets/{default['id']}",
        json={"name": "Campus rules", "days": default["days"]},
        headers=head,
    )
    assert r.status_code == 200, r.text
    r = client.put(
        "/admin/holidays/2026-12-25", json={"day": "2026-12-25", "name": "Christmas"}, headers=head
    )
    assert r.status_code == 200
    assert client.get("/admin/hostels", headers=head).status_code == 200


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("post", "/admin/gates", {"name": "X", "lat": 30.0, "lng": 78.0, "radius_m": 75}),
        ("get", "/admin/users?q=anna", None),
        ("get", "/admin/settings", None),
    ],
)
def test_gates_people_and_settings_stay_with_admins(client, head, method, path, body):
    r = client.request(method, path, json=body, headers=head)
    assert r.status_code == 403 and r.json()["detail"] == "Admins only"


def test_a_head_warden_cant_drop_wardens_by_deleting_their_hostel(
    client, admin, head, warden, hostels
):
    # Hostel A has a warden: deleting it would silently remove that assignment (admin-only).
    r = client.delete(f"/admin/hostels/{hostels['A']}", headers=head)
    assert r.status_code == 409, r.text
    assert any(h["id"] == hostels["A"] for h in client.get("/admin/hostels", headers=head).json())
    assert {h["name"] for h in client.get("/admin/my-hostels", headers=warden).json()} == {
        "Hostel A"
    }
    # A hostel nobody looks after can go, and an admin can still delete either.
    assert client.delete(f"/admin/hostels/{hostels['B']}", headers=head).status_code == 200
    assert client.delete(f"/admin/hostels/{hostels['A']}", headers=admin).status_code == 200


def test_wardens_cant_edit_rules(client, warden):
    r = client.put(
        "/admin/holidays/2026-12-25", json={"day": "2026-12-25", "name": "X"}, headers=warden
    )
    assert r.status_code == 403 and r.json()["detail"] == "Admins and head wardens only"


def test_a_request_without_a_hostel_warden_goes_to_head_wardens(
    client, db, push, admin, head, bina
):
    set_rules(db, "open", max_minutes=180, needs_form=True)
    register_token(client, head, "ExponentPushToken[headWarden0001]")
    register_token(client, admin, ADMIN_PHONE)
    client.post("/outings/request", json=FORM, headers=bina)  # Hostel B has no warden
    assert [t for t, _ in push.outbox] == [["ExponentPushToken[headWarden0001]"]]


def test_escalations_also_reach_head_wardens(client, db, push, admin, head, anna):
    set_rules(db, "open")
    register_token(client, head, "ExponentPushToken[headWarden0001]")
    go_out(client, anna)
    db.execute(
        text(
            "UPDATE outings SET left_at = now() - interval '3 hours', "
            "expected_return_at = now() - interval '45 minutes', "
            "overdue_notified_at = now() - interval '11 minutes'"
        )
    )
    db.commit()
    run_sweep(client, push)
    assert ["ExponentPushToken[headWarden0001]"] in [t for t, _ in push.outbox]
