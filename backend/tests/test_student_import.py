"""Admins add students from a CSV; each gets a one-time link to choose a password. Admins can
also reset a student's password with such a link."""

import re
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from app.services import student_import
from tests.helpers import PASSWORD, auth_header, login, make_admin, signup

NEW_PASSWORD = "lantern-river-quiet"
HEADER = "index,student_id,name,phone number,parent's name,number,hostel\n"


@pytest.fixture(autouse=True)
def no_gap(monkeypatch):
    monkeypatch.setattr(student_import, "SEND_GAP_SECONDS", 0)


@pytest.fixture
def admin(client, db):
    _, headers = signup(client, "boss@geu.ac.in", "Boss")
    make_admin(db, "boss@geu.ac.in")
    return headers


@pytest.fixture
def hostel(client, admin) -> str:
    default = client.get("/admin/rule-sets", headers=admin).json()[0]
    r = client.post(
        "/admin/hostels", json={"name": "Hostel 3", "rule_set_id": default["id"]}, headers=admin
    )
    assert r.status_code == 201, r.text
    return next(h["id"] for h in r.json() if h["name"] == "Hostel 3")


def upload(client, headers, csv: str, confirm: bool = False):
    return client.post(
        "/admin/students/import", json={"csv": csv, "confirm": confirm}, headers=headers
    )


def link_token(client, email: str) -> str:
    sent = [m for m in client.app.state.mailer.outbox if m.to == email]
    assert sent, f"no email to {email}"
    match = re.search(r"/set-password#t=([A-Za-z0-9_-]+)", sent[-1].body)
    assert match, sent[-1].body
    return match.group(1)


def set_password(client, token: str, password: str = NEW_PASSWORD):
    return client.post("/auth/set-password", json={"token": token, "password": password})


GOOD = (
    HEADER
    + "1,2510370001,Riya Sharma,98765 43210,Sunita Sharma,91234 56789,hostel 3\n"
    + "2,2510370002,Aman Verma,,,,\n"
)


def test_check_then_confirm_adds_students_and_emails_each_a_link(client, admin, hostel, db):
    check = upload(client, admin, GOOD)
    assert check.status_code == 200, check.text
    body = check.json()
    assert (body["new"], body["added"], body["errors"]) == (2, 0, 0)
    assert [r["email"] for r in body["rows"]] == [
        "2510370001@example.com",  # the first allowed domain (geu.ac.in in production)
        "2510370002@example.com",
    ]
    assert body["rows"][0]["hostel"] == "Hostel 3"  # matched ignoring case
    assert client.app.state.mailer.outbox[-1].to == "boss@geu.ac.in"  # nothing sent yet
    assert db.execute(text("SELECT count(*) FROM users")).scalar_one() == 1

    done = upload(client, admin, GOOD, confirm=True).json()
    assert done["added"] == 2 and {r["status"] for r in done["rows"]} == {"added"}
    riya = db.execute(
        text(
            "SELECT roll_no, phone, emergency_name, emergency_relation, emergency_phone, "
            "hostel_id::text, email_verified_at FROM users WHERE email = '2510370001@example.com'"
        )
    ).one()
    assert riya[:6] == (
        "2510370001",
        "+919876543210",
        "Sunita Sharma",
        "Parent",
        "+919123456789",
        hostel,
    )
    assert riya[6] is None  # verified when the link is used
    email = next(m for m in client.app.state.mailer.outbox if m.to == "2510370001@example.com")
    assert email.subject == "Lumiback: set up your account" and "7 days" in email.body
    sent = "SELECT count(*) FROM account_links WHERE sent_at IS NOT NULL"
    assert db.execute(text(sent)).scalar_one() == 2
    audit = db.execute(text("SELECT action, target FROM admin_audit")).all()
    assert ("people:import", "2 accounts (0 staff)") in audit

    # Importing the same file again adds nobody.
    again = upload(client, admin, GOOD, confirm=True).json()
    assert again["added"] == 0 and again["existing"] == 2


def test_an_imported_student_chooses_a_password_with_the_link(client, admin, hostel):
    upload(client, admin, GOOD, confirm=True)
    email = "2510370001@example.com"
    # No password works before the link is used.
    assert (
        client.post("/auth/login", json={"email": email, "password": PASSWORD}).status_code == 401
    )
    token = link_token(client, email)
    info = client.post("/auth/password-link", json={"token": token})
    assert info.json() == {"name": "Riya Sharma", "email": email, "invite": True}

    weak = set_password(client, token, "password1234")
    assert weak.status_code == 422
    r = set_password(client, token)
    assert r.status_code == 200 and r.json() == {"email": email}
    me = client.get("/auth/me", headers=auth_header(login(client, email, NEW_PASSWORD))).json()
    assert me["name"] == "Riya Sharma"
    assert set_password(client, token).status_code == 404  # works once
    assert client.post("/auth/password-link", json={"token": token}).status_code == 404


def test_rows_with_problems_are_reported_and_skipped(client, admin, hostel, db):
    signup(client, "2510370009@example.com", "Already Here")
    csv = (
        HEADER
        + "1,25-10,Bad Id,,,,\n"
        + "2,2510370003,,,,,\n"
        + "3,2510370004,Phone Wrong,12345,,,\n"
        + "4,2510370005,No Parent Number,,Mum,,\n"
        + "5,2510370006,Wrong Hostel,,,,Hostel 99\n"
        + "6,2510370007,Twice,,,,\n"
        + "7,2510370007,Twice Again,,,,\n"
        + "8,2510370009,Already Here,,,,\n"
        + "9,2510370010,<img src=x onerror=alert(1)>,,,,\n"
    )
    rows = {r["line"]: r for r in upload(client, admin, csv).json()["rows"]}
    assert rows[2]["error"].startswith("Student ID: should be 3 to 32 letters or digits")
    assert rows[3]["error"].startswith("Name")
    assert rows[4]["error"].startswith("Phone")
    assert rows[5]["error"] == "Parent's number: needed with the parent's name"
    assert rows[6]["error"].startswith("Hostel: no hostel named that (known: Hostel 3)")
    assert rows[7]["status"] == "new"
    assert rows[8]["error"] == "Email: same as line 7"
    assert rows[9]["status"] == "exists"
    # A name is plain text: kept as typed, escaped wherever it's shown.
    assert rows[10]["status"] == "new" and rows[10]["name"] == "<img src=x onerror=alert(1)>"

    done = upload(client, admin, csv, confirm=True).json()
    assert (done["added"], done["errors"], done["existing"]) == (2, 6, 1)
    count = db.execute(text("SELECT count(*) FROM users WHERE email LIKE '25103700%'")).scalar_one()
    assert count == 3  # the two new ones plus the one already there


@pytest.mark.parametrize(
    ("csv", "message"),
    [
        pytest.param("", None, id="empty"),
        pytest.param(
            "name,phone\nRiya,98765 43210\n",
            'The first row needs a "student_id" or an "email" column.',
            id="no-id-column",
        ),
        pytest.param(
            "student_id,name\n", "The file has a header but no students.", id="header-only"
        ),
        pytest.param(
            "student_id,name\n1" + chr(0) + ",x\n",
            "This doesn't look like a CSV file. Save the sheet as CSV.",
            id="binary",
        ),
        pytest.param(
            "student_id,name\n" + "a" * 530_000,
            "The file is larger than 512 KB. Split it into smaller files.",
            id="too-big",
        ),
        pytest.param("student_id,name\n" + "a" * 600_001, None, id="over-the-request-cap"),
    ],
)
def test_unreadable_files_are_refused_whole(client, admin, csv, message):
    r = upload(client, admin, csv)
    assert r.status_code == 422
    if message:
        assert r.json()["detail"] == message


def test_too_many_rows_are_refused(client, admin):
    csv = "student_id,name\n" + "".join(
        f"25{i:08d},Student {i}\n" for i in range(student_import.MAX_ROWS + 1)
    )
    r = upload(client, admin, csv)
    assert r.status_code == 422 and "more than 2000" in r.json()["detail"]


def test_excel_csv_with_bom_semicolons_and_other_headers(client, admin):
    csv = (
        chr(0xFEFF)
        + "Roll No;Student Name;Mobile;Parent Name;Parent Phone\r\n"
        + ("2510370011;Isha Rao;9876543210;Ravi Rao;9123456789\r\n")
    )
    rows = upload(client, admin, csv).json()["rows"]
    assert rows[0]["status"] == "new" and rows[0]["student_id"] == "2510370011"


def test_only_admins_import_or_send_links(client, admin, db):
    _, warden = signup(client, "warden@geu.ac.in", "Warden")
    db.execute(text("UPDATE users SET role = 'head_warden' WHERE email = 'warden@geu.ac.in'"))
    db.commit()
    _, student = signup(client, "riya@geu.ac.in", "Riya")
    riya_id = client.get("/admin/users", params={"q": "riya"}, headers=admin).json()[0]["id"]
    for headers in (warden, student):
        assert upload(client, headers, GOOD).status_code == 403
        r = client.post(f"/admin/users/{riya_id}/password-link", headers=headers)
        assert r.status_code == 403
    assert upload(client, {}, GOOD).status_code == 401


def test_an_admin_reset_stops_the_old_password_and_signs_out(client, admin, db):
    _, riya = signup(client, "riya@geu.ac.in", "Riya")
    tokens = login(client, "riya@geu.ac.in")
    riya_id = client.get("/admin/users", params={"q": "riya"}, headers=admin).json()[0]["id"]

    r = client.post(f"/admin/users/{riya_id}/password-link", headers=admin)
    assert r.status_code == 200 and r.json() == {"kind": "reset", "email": "riya@geu.ac.in"}
    assert (
        client.post(
            "/auth/login", json={"email": "riya@geu.ac.in", "password": PASSWORD}
        ).status_code
        == 401
    )
    assert (
        client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]}).status_code
        == 401
    )
    person = client.get("/admin/users", params={"q": "riya"}, headers=admin).json()[0]
    assert person["account"] == "reset"
    email = client.app.state.mailer.outbox[-1]
    assert email.subject == "Lumiback: choose a new password" and "24 hours" in email.body

    old = link_token(client, "riya@geu.ac.in")
    client.post(f"/admin/users/{riya_id}/password-link", headers=admin)  # a newer link
    assert set_password(client, old).status_code == 404  # replaced
    assert set_password(client, link_token(client, "riya@geu.ac.in")).status_code == 200
    login(client, "riya@geu.ac.in", NEW_PASSWORD)
    audit = db.execute(text("SELECT action FROM admin_audit")).scalars().all()
    assert audit.count("password:reset") == 2


def test_an_admin_can_reset_staff_but_not_themself(client, admin, db):
    signup(client, "other@geu.ac.in", "Other Admin")
    make_admin(db, "other@geu.ac.in")
    other = client.get("/admin/users", params={"q": "other"}, headers=admin).json()[0]["id"]
    r = client.post(f"/admin/users/{other}/password-link", headers=admin)
    assert r.status_code == 200 and r.json()["kind"] == "reset"
    me = client.get("/admin/users", params={"q": "boss"}, headers=admin).json()[0]["id"]
    r = client.post(f"/admin/users/{me}/password-link", headers=admin)
    assert r.status_code == 403 and "Forgot password" in r.json()["detail"]


def test_staff_rows_get_their_role_and_a_warden_their_hostel(client, admin, hostel, db):
    csv = (
        "name,email,role,hostel,student_id\n"
        "Meera Warden,meera@geu.ac.in,Warden,Hostel 3,\n"
        "Head Person,head@geu.ac.in,head warden,,\n"
        "New Admin,newadmin@geu.ac.in,ADMIN,,\n"
        "No Hostel Warden,nohostel@geu.ac.in,warden,,\n"
        "Odd Role,odd@geu.ac.in,principal,,\n"
        "No Id Student,nostudentid@geu.ac.in,,,\n"
    )
    rows = {r["line"]: r for r in upload(client, admin, csv).json()["rows"]}
    assert [rows[n]["role"] for n in (2, 3, 4)] == ["warden", "head_warden", "admin"]
    assert {rows[n]["status"] for n in (2, 3, 4)} == {"new"}
    assert rows[5]["error"] == "Hostel: a warden needs the hostel they look after"
    assert rows[6]["error"].startswith("Role: use student, warden, head warden or admin")
    assert rows[7]["error"] == "Student ID: is missing"

    assert upload(client, admin, csv, confirm=True).json()["added"] == 3
    roles = dict(db.execute(text("SELECT email, role FROM users")).all())
    assert roles["meera@geu.ac.in"] == "warden" and roles["head@geu.ac.in"] == "head_warden"
    assert roles["newadmin@geu.ac.in"] == "admin"
    looks_after = db.execute(
        text(
            "SELECT w.hostel_id::text FROM warden_hostels w JOIN users u ON u.id = w.user_id "
            "WHERE u.email = 'meera@geu.ac.in'"
        )
    ).scalar_one()
    assert looks_after == hostel
    audit = db.execute(text("SELECT target FROM admin_audit")).scalars().all()
    assert "3 accounts (3 staff)" in audit


def test_an_imported_role_can_be_corrected_before_it_is_claimed(client, admin, db):
    csv = "name,email,role\nWrong Admin,wrong@geu.ac.in,admin\n"
    assert upload(client, admin, csv, confirm=True).json()["added"] == 1
    target = client.get("/admin/users", params={"q": "wrong"}, headers=admin).json()[0]
    assert target["account"] == "invited"
    r = client.post(f"/admin/users/{target['id']}/role", json={"role": "student"}, headers=admin)
    assert r.status_code == 200 and r.json()["role"] == "student"


def test_an_unclaimed_admin_invite_does_not_count_as_another_admin(client, admin, db):
    csv = "name,email,role\nSecond Admin,second@geu.ac.in,admin\n"
    upload(client, admin, csv, confirm=True)
    me = client.get("/admin/users", params={"q": "boss"}, headers=admin).json()[0]["id"]
    r = client.post(f"/admin/users/{me}/role", json={"role": "student"}, headers=admin)
    assert r.status_code == 409
    # Once the invite is claimed, there are two admins who can sign in.
    assert set_password(client, link_token(client, "second@geu.ac.in")).status_code == 200
    r = client.post(f"/admin/users/{me}/role", json={"role": "student"}, headers=admin)
    assert r.status_code == 200


def test_a_link_expires(client, admin, db):
    upload(client, admin, GOOD, confirm=True)
    token = link_token(client, "2510370002@example.com")
    db.execute(
        text("UPDATE account_links SET created_at = :t - interval '8 days', expires_at = :t"),
        {"t": datetime.now(UTC) - timedelta(seconds=1)},
    )
    db.commit()
    assert set_password(client, token).status_code == 404


def test_forgot_password_sends_an_imported_student_a_new_link(client, admin):
    upload(client, admin, GOOD, confirm=True)
    email = "2510370002@example.com"
    first = link_token(client, email)
    r = client.post("/auth/forgot-password", json={"email": email})
    assert r.status_code == 202
    second = link_token(client, email)
    assert second != first
    assert set_password(client, first).status_code == 404
    assert set_password(client, second).status_code == 200


def test_imported_students_show_in_the_office_lists(client, admin, hostel):
    upload(client, admin, GOOD, confirm=True)
    people = client.get("/admin/users", params={"q": "2510370"}, headers=admin).json()
    assert {p["account"] for p in people} == {"invited"}
    students = client.get("/admin/students", params={"hostel_id": hostel}, headers=admin).json()
    assert [(s["name"], s["account"]) for s in students] == [("Riya Sharma", "invited")]


@pytest.mark.parametrize("stored", [None, "!no-password", "not-a-hash"])
def test_accounts_without_a_password_still_cost_one_argon2_check(monkeypatch, stored):
    from app.security import passwords

    checked = []
    real = passwords._hasher

    class Spy:
        def verify(self, h, p):
            checked.append(h)
            return real.verify(h, p)

    monkeypatch.setattr(passwords, "_hasher", Spy())
    assert passwords.verify_password(stored, "timing-equalizer-not-a-password") is False
    assert checked == [passwords._DUMMY_HASH]


def test_bad_tokens_are_rate_limited(client):
    for _ in range(20):
        assert set_password(client, "x" * 43).status_code == 404
    assert set_password(client, "x" * 43).status_code == 429
