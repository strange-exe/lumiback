"""The hostel office's account controls: turning an account off and on, correcting someone's
details, and cancelling an invite nobody used."""

import pytest
from sqlalchemy import text

from app.push import MemoryPushSender
from app.services import student_import
from tests.helpers import PASSWORD, befriend, login, make_admin, share_with, signup
from tests.test_student_import import HEADER, link_token, set_password, upload
from tests.test_wardens import set_role, student, user_id

ANNA = "anna@geu.ac.in"


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


@pytest.fixture(autouse=True)
def no_gap(monkeypatch):
    monkeypatch.setattr(student_import, "SEND_GAP_SECONDS", 0)


@pytest.fixture
def push(client) -> MemoryPushSender:
    sender = MemoryPushSender()
    client.app.state.push = sender
    return sender


@pytest.fixture
def anna(client, hostels):
    return student(client, ANNA, "Anna", hostels["A"])


@pytest.fixture
def warden(client, admin, hostels):
    headers = signup(client, "warden.a@geu.ac.in", "Warden A")[1]
    assert (
        set_role(client, admin, "warden.a@geu.ac.in", "warden", [hostels["A"]]).status_code == 200
    )
    return headers


def turn(client, headers, uid: str, on: bool):
    return client.post(f"/admin/users/{uid}/active", json={"on": on}, headers=headers)


def edit(client, headers, uid: str, **body):
    return client.patch(f"/admin/users/{uid}", json=body, headers=headers)


def register_phone(client, headers, token: str) -> None:
    r = client.post(
        "/devices/push-token", json={"token": token, "platform": "android"}, headers=headers
    )
    assert r.status_code == 204, r.text


def audit_rows(db) -> list[tuple[str, str]]:
    return [tuple(r) for r in db.execute(text("SELECT action, target FROM admin_audit")).all()]


# ---------- off and on ----------


def test_turning_off_signs_out_everywhere_and_keeps_the_record(client, db, admin, anna):
    tokens = login(client, ANNA)
    register_phone(client, anna, "ExponentPushToken[annaPhone00001]")
    client.post("/outings", json={"destination": "Rajpur Road"}, headers=anna)
    client.post("/outings/current/return", headers=anna)
    uid = user_id(client, admin, ANNA)

    r = turn(client, admin, uid, on=False)
    assert r.status_code == 200, r.text
    assert r.json()["account"] == "off"

    assert client.get("/auth/me", headers=anna).status_code == 401
    assert (
        client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]}).status_code
        == 401
    )
    wrong = client.post("/auth/login", json={"email": ANNA, "password": "not-the-password"})
    assert wrong.status_code == 401  # nothing revealed without the right password
    right = client.post("/auth/login", json={"email": ANNA, "password": PASSWORD})
    assert right.status_code == 403 and "turned off" in right.json()["detail"]
    tokens_left = db.execute(
        text(
            "SELECT count(*) FROM push_tokens pt JOIN users u ON u.id = pt.user_id "
            "WHERE u.email = :e"
        ),
        {"e": ANNA},
    ).scalar()
    assert tokens_left == 0
    kept = db.execute(
        text(
            "SELECT count(*) FROM outings o JOIN users u ON u.id = o.student_id WHERE u.email = :e"
        ),
        {"e": ANNA},
    ).scalar()
    assert kept == 1
    assert ("account:off", ANNA) in audit_rows(db)

    back = turn(client, admin, uid, on=True)
    assert back.status_code == 200 and back.json()["account"] == "active"
    assert client.post("/auth/login", json={"email": ANNA, "password": PASSWORD}).status_code == 200
    assert ("account:on", ANNA) in audit_rows(db)


def test_someone_out_right_now_cant_be_turned_off(client, admin, anna):
    client.post("/outings", json={"destination": "Rajpur Road"}, headers=anna)
    r = turn(client, admin, user_id(client, admin, ANNA), on=False)
    assert r.status_code == 409 and "Record their return first" in r.json()["detail"]


def test_turning_off_ends_their_live_shares(client, db, admin, anna):
    friend_user, friend = signup(client, "friend@geu.ac.in", "Friend")
    befriend(client, anna, "friend@geu.ac.in", friend)
    share = share_with(client, anna, [friend_user["id"]])
    assert turn(client, admin, user_id(client, admin, ANNA), on=False).status_code == 200
    status = db.execute(
        text("SELECT status, ended_reason FROM share_sessions WHERE id = :id"), {"id": share["id"]}
    ).one()
    assert tuple(status) == ("ended", "account_off")


def test_a_warden_manages_their_own_hostels_students_only(client, admin, hostels, warden, anna):
    bina = student(client, "bina@geu.ac.in", "Bina", hostels["B"])
    assert bina
    anna_id = user_id(client, admin, ANNA)
    bina_id = user_id(client, admin, "bina@geu.ac.in")
    office_id = user_id(client, admin, "office@geu.ac.in")

    assert turn(client, warden, anna_id, on=False).status_code == 200
    assert turn(client, warden, anna_id, on=True).status_code == 200
    assert turn(client, warden, bina_id, on=False).status_code == 404  # not theirs
    assert turn(client, warden, office_id, on=False).status_code == 404  # staff: admins only
    assert edit(client, warden, bina_id, name="Bee").status_code == 404

    named = edit(client, warden, anna_id, name="Anna Rawat", roll_no="2510370099")
    assert named.status_code == 200, named.text
    assert (named.json()["name"], named.json()["roll_no"]) == ("Anna Rawat", "2510370099")
    email = edit(client, warden, anna_id, email="someone.else@geu.ac.in")
    assert email.status_code == 403 and "Only an admin" in email.json()["detail"]


def test_nobody_turns_off_their_own_account(client, admin):
    me = user_id(client, admin, "office@geu.ac.in")
    assert turn(client, admin, me, on=False).status_code == 403
    assert edit(client, admin, me, name="Me").status_code == 403


def test_a_student_cant_use_the_controls(client, admin, anna):
    uid = user_id(client, admin, ANNA)
    assert turn(client, anna, uid, on=False).status_code == 403
    assert edit(client, anna, uid, name="x").status_code == 403


def test_a_turned_off_warden_no_longer_gets_their_hostels_asks(
    client, db, push, admin, hostels, warden, anna
):
    register_phone(client, warden, "ExponentPushToken[wardenAphone01]")
    register_phone(client, admin, "ExponentPushToken[adminPhone0001]")
    client.post("/outings", json={"destination": "Rajpur Road"}, headers=anna)
    assert (
        turn(client, admin, user_id(client, admin, "warden.a@geu.ac.in"), on=False).status_code
        == 200
    )

    outing = client.get("/outings/current", headers=anna).json()
    r = client.post(
        f"/outings/{outing['id']}/correction",
        json={"kind": "cancel", "reason": "wrong_tap"},
        headers=anna,
    )
    assert r.status_code in (200, 201), r.text
    sent_to = [tokens for tokens, _ in push.outbox]
    assert any("ExponentPushToken[adminPhone0001]" in t for t in sent_to)
    assert not any("ExponentPushToken[wardenAphone01]" in t for t in sent_to)


def test_no_password_link_for_an_account_thats_off(client, admin, anna):
    uid = user_id(client, admin, ANNA)
    turn(client, admin, uid, on=False)
    r = client.post(f"/admin/users/{uid}/password-link", headers=admin)
    assert r.status_code == 409


# ---------- details ----------


def test_an_admin_corrects_a_typo_in_an_email(client, db, admin, anna):
    uid = user_id(client, admin, ANNA)
    r = edit(client, admin, uid, email="Anna.Rawat@geu.ac.in", phone="98765 43210")
    assert r.status_code == 200, r.text
    assert r.json()["email"] == "anna.rawat@geu.ac.in"
    assert (
        client.post(
            "/auth/login", json={"email": "anna.rawat@geu.ac.in", "password": PASSWORD}
        ).status_code
        == 200
    )
    phone = db.execute(text("SELECT phone FROM users WHERE id = :id"), {"id": uid}).scalar()
    assert phone == "+919876543210"
    assert (
        "account:edit",
        f"anna.rawat@geu.ac.in: phone, email {ANNA} -> anna.rawat@geu.ac.in",
    ) in audit_rows(db)

    cleared = edit(client, admin, uid, roll_no=None)
    assert cleared.status_code == 200 and cleared.json()["roll_no"] is None


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({"email": "office@geu.ac.in"}, 409),  # someone else's
        ({"email": "anna@gmail.com"}, 422),  # not a university address
        ({"roll_no": "25/10"}, 422),
        ({"roll_no": "".join(map(chr, (0x662, 0x665, 0x661, 0x660)))}, 422),  # not ASCII digits
        ({"phone": "12345"}, 422),
        ({"name": None}, 422),
        ({"name": "   "}, 422),
        ({"hostel": "B"}, 422),  # not a field here
    ],
)
def test_details_are_checked(client, admin, anna, body, code):
    r = edit(client, admin, user_id(client, admin, ANNA), **body)
    assert r.status_code == code, r.text


# ---------- invites ----------


def imported(client, admin) -> str:
    r = upload(client, admin, HEADER + "1,2510370007,Kabir Negi,,,,\n", confirm=True)
    assert r.status_code == 200 and r.json()["added"] == 1, r.text
    return "2510370007@example.com"


def test_an_admin_cancels_an_unused_invite(client, db, admin):
    email = imported(client, admin)
    waiting = client.get("/admin/students", params={"account": "invited"}, headers=admin).json()
    assert [p["email"] for p in waiting] == [email]
    token = link_token(client, email)

    r = client.delete(f"/admin/users/{waiting[0]['id']}/invite", headers=admin)
    assert r.status_code == 204, r.text
    assert (
        db.execute(text("SELECT count(*) FROM users WHERE email = :e"), {"e": email}).scalar() == 0
    )
    assert set_password(client, token).status_code == 404  # the emailed link is dead too
    assert ("invite:cancel", email) in audit_rows(db)


def test_only_unused_invites_can_be_cancelled_and_only_by_admins(
    client, admin, hostels, warden, anna
):
    uid = user_id(client, admin, ANNA)
    used = client.delete(f"/admin/users/{uid}/invite", headers=admin)
    assert used.status_code == 409 and "Turn it off instead" in used.json()["detail"]
    email = imported(client, admin)
    invited = client.get("/admin/users", params={"q": email}, headers=admin).json()[0]["id"]
    assert client.delete(f"/admin/users/{invited}/invite", headers=warden).status_code == 403


def test_the_office_lists_accounts_that_are_off(client, admin, anna):
    turn(client, admin, user_id(client, admin, ANNA), on=False)
    off = client.get("/admin/students", params={"account": "off"}, headers=admin).json()
    assert [(p["email"], p["account"]) for p in off] == [(ANNA, "off")]
    everyone = client.get("/admin/students", headers=admin).json()
    assert {p["email"]: p["account"] for p in everyone}[ANNA] == "off"


# ---------- adding one person ----------


def add(client, headers, **body):
    return client.post("/admin/people", json=body, headers=headers)


def test_an_admin_adds_one_student_who_gets_a_link(client, db, admin, hostels):
    r = add(
        client,
        admin,
        name="Kabir Negi",
        student_id="2510370042",
        hostel_id=hostels["A"],
        phone="98765 43210",
        parent_name="Meera Negi",
        parent_phone="91234 56789",
    )
    assert r.status_code == 201, r.text
    assert (r.json()["email"], r.json()["hostel"], r.json()["status"]) == (
        "2510370042@example.com",
        "Hostel A",
        "added",
    )
    row = db.execute(
        text("SELECT roll_no, phone, emergency_phone FROM users WHERE email = :e"),
        {"e": "2510370042@example.com"},
    ).one()
    assert tuple(row) == ("2510370042", "+919876543210", "+919123456789")
    assert set_password(client, link_token(client, "2510370042@example.com")).status_code == 200
    assert ("people:add", "2510370042@example.com (student)") in audit_rows(db)


def test_an_admin_adds_a_warden_of_a_hostel(client, admin, hostels):
    r = add(
        client,
        admin,
        name="Rekha Joshi",
        role="warden",
        email="rekha@geu.ac.in",
        hostel_id=hostels["B"],
    )
    assert r.status_code == 201, r.text
    person = client.get("/admin/users", params={"q": "rekha@geu.ac.in"}, headers=admin).json()[0]
    assert (person["role"], person["hostels"], person["account"]) == (
        "warden",
        ["Hostel B"],
        "invited",
    )


@pytest.mark.parametrize(
    ("body", "code", "message"),
    [
        ({"name": "No Id"}, 422, "Student ID"),
        ({"name": "Bad Id", "student_id": "25/1"}, 422, "Student ID"),
        ({"name": "X", "role": "warden", "email": "w@geu.ac.in"}, 422, "Hostel"),
        ({"name": "X", "student_id": "2510370050", "email": "x@gmail.com"}, 422, "Email"),
        ({"name": "X", "student_id": "2510370051", "phone": "123"}, 422, "Phone"),
        ({"name": "X", "student_id": "2510370052", "parent_name": "P"}, 422, "Parent"),
        ({"name": "Office", "role": "admin", "email": "office@geu.ac.in"}, 409, "already"),
    ],
)
def test_one_person_is_checked_like_a_csv_row(client, admin, body, code, message):
    r = add(client, admin, **body)
    assert r.status_code == code and message in r.json()["detail"], r.text


def test_only_admins_add_people(client, admin, hostels, warden):
    r = add(client, warden, name="Kabir Negi", student_id="2510370042", hostel_id=hostels["A"])
    assert r.status_code == 403
