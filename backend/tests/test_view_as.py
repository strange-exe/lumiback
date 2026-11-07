"""The developer role and its read-only "view as ROLE" (X-View-As-Role), per the 2026-11-07
contract: developers pass every admin check, the dashboard can't change them, and viewing a
role's screens runs as the developer (their own data) and never writes anything."""

import importlib.util
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from alembic import command
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.api.deps import CurrentUser, SessionDep
from app.push import MemoryPushSender
from app.schemas import PersonIn, RoleIn
from tests.conftest import alembic_config
from tests.helpers import PASSWORD, befriend, make_admin, share_with, signup
from tests.test_admin import ADMIN_GETS
from tests.test_escalations import go_out, late_by, run_sweep

HEADER = "X-View-As-Role"
ROLES = ["admin", "head_warden", "warden", "student"]
UNKNOWN_ROLE = "Unknown role to view as"
DEVELOPERS_ONLY = "View as is for developers only"
READ_ONLY = "Read-only while viewing as another role"
LOCKED = "A developer's account is changed on the server, not here"

CONTACTS = {
    "phone": "9876543210",
    "emergency_name": "Sunita",
    "emergency_relation": "Mother",
    "emergency_phone": "9123456789",
}


def make_developer(db, email: str) -> None:
    db.execute(text("UPDATE users SET role = 'developer' WHERE email = :e"), {"e": email})
    db.commit()


def as_(headers: dict, role: str) -> dict:
    """`headers` viewing as `role` (any raw header value)."""
    return {**headers, HEADER: role}


def audit(db) -> list[tuple]:
    return [
        tuple(r)
        for r in db.execute(text("SELECT action, target FROM admin_audit ORDER BY id")).all()
    ]


def count(db, table: str) -> int:
    return db.execute(text(f"SELECT count(*) FROM {table}")).scalar_one()  # noqa: S608 - fixed names


@pytest.fixture
def dev(client, db):
    user, headers = signup(client, "dev@example.com", "Dev Eloper")
    make_developer(db, "dev@example.com")
    return user, headers


@pytest.fixture
def admin(client, db):
    user, headers = signup(client, "admin@example.com", "Asha Admin")
    make_admin(db, "admin@example.com")
    return user, headers


@pytest.fixture
def riya(client):
    user, headers = signup(client, "riya@example.com", "Riya")
    r = client.patch("/profile", json={"contacts": CONTACTS}, headers=headers)
    assert r.status_code == 200, r.text
    return user, headers


# ---------- the header: which values, and who may send it ----------


@pytest.mark.parametrize("value", ["", "   "])
def test_an_absent_or_empty_header_is_a_normal_request(client, dev, value):
    me = client.get("/auth/me", headers=as_(dev[1], value)).json()
    assert (me["role"], me["viewing_as"]) == ("developer", None)
    # Not read-only either: the developer can still change things.
    r = client.post(
        "/admin/gates",
        json={"name": "Back Gate", "lat": 30.2, "lng": 77.9},
        headers=as_(dev[1], value),
    )
    assert r.status_code == 201, r.text


@pytest.mark.parametrize(
    "value", ["developer", "Admin", "STUDENT", "superuser", "student,admin", "head-warden"]
)
def test_an_unknown_role_is_a_400(client, dev, value):
    for method, path in (("GET", "/auth/me"), ("POST", "/outings")):
        r = client.request(method, path, json={"destination": "X"}, headers=as_(dev[1], value))
        assert (r.status_code, r.json()["detail"]) == (400, UNKNOWN_ROLE), (method, value)


@pytest.mark.parametrize("who", ["student", "warden", "head_warden", "admin"])
@pytest.mark.parametrize("viewed", ROLES)
def test_the_header_is_for_developers_only(client, db, who, viewed):
    _, headers = signup(client, "someone@example.com", "Someone")
    db.execute(text("UPDATE users SET role = :r WHERE email = 'someone@example.com'"), {"r": who})
    db.commit()
    r = client.get("/auth/me", headers=as_(headers, viewed))
    assert (r.status_code, r.json()["detail"]) == (403, DEVELOPERS_ONLY)
    # Writes too, before anything else is looked at.
    r = client.post("/outings", json={"destination": "X"}, headers=as_(headers, viewed))
    assert (r.status_code, r.json()["detail"]) == (403, DEVELOPERS_ONLY)
    assert count(db, "outings") == 0


def test_the_role_is_reread_from_the_database(client, db, dev):
    """A developer demoted after their token was issued is refused at once."""
    assert client.get("/auth/me", headers=as_(dev[1], "student")).status_code == 200
    db.execute(text("UPDATE users SET role = 'admin' WHERE email = 'dev@example.com'"))
    db.commit()
    r = client.get("/auth/me", headers=as_(dev[1], "student"))
    assert (r.status_code, r.json()["detail"]) == (403, DEVELOPERS_ONLY)


def test_without_a_token_the_header_changes_nothing(client):
    assert client.get("/auth/me", headers={HEADER: "student"}).status_code == 401


def test_the_old_account_header_is_ignored(client, dev, riya):
    me = client.get("/auth/me", headers={**dev[1], "X-View-As": riya[0]["id"]}).json()
    assert (me["id"], me["role"], me["viewing_as"]) == (dev[0]["id"], "developer", None)


def test_cors_allows_the_header(client):
    r = client.options(
        "/auth/me",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization,x-view-as-role",
        },
    )
    assert r.status_code == 200
    assert "x-view-as-role" in r.headers["access-control-allow-headers"].lower()


# ---------- /auth/me ----------


@pytest.mark.parametrize("viewed", ROLES)
def test_me_reports_the_viewed_role(client, dev, viewed):
    me = client.get("/auth/me", headers=as_(dev[1], viewed)).json()
    assert (me["id"], me["email"]) == (dev[0]["id"], "dev@example.com")  # still the developer
    assert (me["role"], me["viewing_as"]) == (viewed, viewed)
    assert "viewer" not in me


def test_me_viewing_as_is_null_otherwise(client, dev, riya, admin):
    me = client.get("/auth/me", headers=dev[1]).json()
    assert (me["role"], me["viewing_as"]) == ("developer", None)
    for headers, role in ((riya[1], "student"), (admin[1], "admin")):
        me = client.get("/auth/me", headers=headers).json()
        assert (me["role"], me["viewing_as"]) == (role, None)
        assert "viewer" not in me


# ---------- the role's screens load with the developer's own data ----------

STUDENT_GETS = [
    "/auth/me",
    "/auth/devices",
    "/outings/current",
    "/outings?limit=20",
    "/outings/summary",
    "/outings/request",
    "/campus",
    "/profile",
    "/hostels",
    "/sessions/mine",
    "/sessions/watching",
    "/contacts",
]
STAFF_GETS = [
    *ADMIN_GETS,
    "/admin/late-today",
    "/admin/students",
    "/admin/requests",
    "/admin/rule-sets",
    "/admin/hostels",
    "/admin/holidays",
    "/admin/escalations",
    "/admin/escalations?state=all",
    "/admin/corrections",
    "/admin/my-hostels",
]


@pytest.mark.parametrize("viewed", ROLES)
def test_every_screen_read_answers_a_developer(client, dev, viewed):
    """Each role's screens call these; the developer's own access answers them all (the
    student ones with empty states). Never a 403 or a 500."""
    paths = STUDENT_GETS if viewed == "student" else STUDENT_GETS + STAFF_GETS
    failed = {}
    for path in paths:
        r = client.get(path, headers=as_(dev[1], viewed))
        if r.status_code != 200:
            failed[path] = (r.status_code, r.text[:200])
    assert failed == {}


def test_student_screens_show_the_developers_own_empty_data(client, dev, riya):
    go_out(client, riya[1])  # someone else's outing never shows
    h = as_(dev[1], "student")
    assert client.get("/outings/current", headers=h).json() is None
    assert client.get("/outings?limit=20", headers=h).json()["items"] == []
    assert client.get("/outings/request", headers=h).json() is None
    assert client.get("/sessions/mine", headers=h).json() == []
    assert client.get("/sessions/watching", headers=h).json() == []
    contacts = client.get("/contacts", headers=h).json()
    assert contacts == client.get("/contacts", headers=dev[1]).json()
    profile = client.get("/profile", headers=h).json()
    assert profile == client.get("/profile", headers=dev[1]).json()
    # This device is still the developer's own, current sign-in.
    assert [d["current"] for d in client.get("/auth/devices", headers=h).json()] == [True]


def test_staff_screens_show_every_hostel(client, dev, riya):
    go_out(client, riya[1])
    out = client.get("/admin/outings", headers=as_(dev[1], "warden")).json()
    assert out == client.get("/admin/outings", headers=dev[1]).json()
    assert "Riya" in str(out)


# ---------- every change is refused ----------

NEW = "x" * 20
PUSH_TOKEN = "ExponentPushToken[abcdefgh12]"
WRITES = [
    ("student", "POST", "/outings", {"destination": "Rajpur Road"}),
    ("student", "PATCH", "/profile", {"contacts": CONTACTS}),
    ("student", "POST", "/outings/request", {"purpose": "Visiting family", "minutes": 120}),
    ("student", "POST", "/outings/current/return", None),
    ("student", "DELETE", f"/contacts/{uuid.UUID(int=1)}", None),
    ("student", "POST", "/contacts", {"email": "riya@example.com"}),
    ("student", "POST", "/auth/change-password", {"current_password": PASSWORD, "password": NEW}),
    ("student", "POST", "/auth/delete-account", {"password": PASSWORD}),
    ("student", "POST", "/auth/devices/sign-out-others", None),
    ("student", "POST", "/devices/push-token", {"token": PUSH_TOKEN, "platform": "ios"}),
    ("student", "POST", "/sessions", {"source": "manual", "duration_minutes": 60}),
    ("admin", "PUT", "/admin/settings", {"curfew": "22:00", "scan_retention_days": 30}),
    ("admin", "POST", "/admin/gates", {"name": "Back Gate", "lat": 30.2, "lng": 77.9}),
    ("admin", "POST", "/admin/users/{riya}/role", {"role": "admin"}),
    ("admin", "POST", "/admin/users/{riya}/active", {"on": False}),
    ("admin", "PATCH", "/admin/users/{riya}", {"name": "Not Riya"}),
    ("head_warden", "PUT", "/admin/holidays/2030-12-25", {"day": "2030-12-25", "name": "Xmas"}),
    ("warden", "POST", "/admin/escalations/{random}/resolve", {}),
]


@pytest.mark.parametrize(
    ("viewed", "method", "path", "body"), WRITES, ids=[f"{v} {m} {p}" for v, m, p, _ in WRITES]
)
def test_every_change_is_refused_while_viewing(client, db, dev, riya, viewed, method, path, body):
    path = path.format(riya=riya[0]["id"], random=uuid.uuid4())
    tables = ["outings", "gates", "contacts", "holidays", "share_sessions", "push_tokens"]
    before = {t: count(db, t) for t in tables}
    r = client.request(method, path, json=body, headers=as_(dev[1], viewed))
    assert (r.status_code, r.json()["detail"]) == (403, READ_ONLY)
    assert {t: count(db, t) for t in tables} == before
    row = db.execute(
        text("SELECT name, role, deactivated_at FROM users WHERE id = :i"), {"i": riya[0]["id"]}
    ).one()
    assert tuple(row) == ("Riya", "student", None)
    assert client.get("/auth/me", headers=dev[1]).status_code == 200  # still signed in


def test_a_read_that_would_write_is_refused_not_written(client, db, dev):
    """The session itself can't write while viewing: GET /admin/settings recreates a missing
    settings row, and here that is refused instead of written."""
    db.execute(text("DELETE FROM campus_settings"))
    db.commit()
    r = client.get("/admin/settings", headers=as_(dev[1], "admin"))
    assert (r.status_code, r.json()["detail"]) == (403, READ_ONLY)
    assert count(db, "campus_settings") == 0
    # As themselves, the same read recreates it.
    assert client.get("/admin/settings", headers=dev[1]).status_code == 200
    assert count(db, "campus_settings") == 1


def test_the_database_refuses_a_raw_write(client, db, dev):
    """The backstop under the ORM checks: a raw SQL UPDATE (which no ORM event recognises as a
    write) still fails, because the transaction is READ ONLY in Postgres."""

    async def sneaky_write(me: CurrentUser, session: SessionDep) -> dict:
        await session.execute(text("UPDATE users SET name = 'Changed' WHERE id = :i"), {"i": me.id})
        await session.commit()
        return {"ok": True}

    client.app.add_api_route("/test-only/sneaky-write", sneaky_write, methods=["GET"])
    with pytest.raises(DBAPIError, match="read-only transaction"):
        client.get("/test-only/sneaky-write", headers=as_(dev[1], "student"))
    name = text("SELECT name FROM users WHERE id = :i")
    assert db.execute(name, {"i": dev[0]["id"]}).scalar_one() == "Dev Eloper"
    # The same route writes without the header: the refusal above came from view as.
    assert client.get("/test-only/sneaky-write", headers=dev[1]).status_code == 200
    db.rollback()  # a fresh snapshot
    assert db.execute(name, {"i": dev[0]["id"]}).scalar_one() == "Changed"


# ---------- reads kept out of view as ----------


def test_the_personal_data_export_is_refused(client, dev):
    r = client.get("/profile/export", headers=as_(dev[1], "student"))
    assert (r.status_code, r.json()["detail"]) == (403, READ_ONLY)
    assert client.get("/profile/export", headers=dev[1]).status_code == 200


def fix(lat=30.31):
    return {"lat": lat, "lng": 78.03, "accuracy_m": 9, "recorded_at": datetime.now(UTC).isoformat()}


def test_a_live_location_is_never_shown_or_logged(client, db, dev, riya):
    befriend(client, riya[1], "dev@example.com", dev[1])
    share = share_with(client, riya[1], [dev[0]["id"]])
    client.put(f"/sessions/{share['id']}/location", json=fix(), headers=riya[1])
    for viewed in ROLES:
        r = client.get(f"/sessions/{share['id']}/location", headers=as_(dev[1], viewed))
        assert (r.status_code, r.json()["detail"]) == (403, READ_ONLY)
    assert count(db, "access_log") == 0
    # The developer, as a viewer Riya chose, still reads it as themselves (and it's logged).
    assert client.get(f"/sessions/{share['id']}/location", headers=dev[1]).status_code == 200
    assert count(db, "access_log") == 1


def test_escalations_while_viewing_show_no_live_position(client, db, dev, riya):
    client.app.state.push = push = MemoryPushSender()
    arjun_user, arjun = signup(client, "arjun@example.com", "Arjun")
    befriend(client, riya[1], "arjun@example.com", arjun)
    share = share_with(client, riya[1], [arjun_user["id"]])
    client.put(f"/sessions/{share['id']}/location", json=fix(), headers=riya[1])
    go_out(client, riya[1])
    late_by(db, 41, alerted_minutes_ago=11)
    run_sweep(client, push)

    for viewed in ("admin", "warden"):
        [e] = client.get("/admin/escalations", headers=as_(dev[1], viewed)).json()
        assert e["name"] == "Riya" and e["last_seen"] is None
    assert count(db, "access_log") == 0
    # The developer as themselves sees it (and the look is logged).
    [e] = client.get("/admin/escalations", headers=dev[1]).json()
    assert e["last_seen"]["kind"] == "live"
    assert count(db, "access_log") == 1


@pytest.mark.parametrize("who", ["dev", "riya"])
def test_websockets_ignore_the_header(client, dev, riya, who):
    """Not honoured, not validated: an unknown role, or a non-developer, still connects."""
    headers = dev[1] if who == "dev" else riya[1]
    token = headers["Authorization"].removeprefix("Bearer ")
    for value in ("student", "nonsense"):
        with client.websocket_connect("/ws", headers={HEADER: value}) as ws:
            ws.send_json({"type": "auth", "token": token})
            assert ws.receive_json() == {"type": "ready"}


# ---------- the account-based view as is gone ----------


@pytest.mark.parametrize(
    ("method", "path"),
    [("GET", "/dev/users"), ("POST", "/dev/view-as"), ("POST", "/dev/view-as/stop")],
)
def test_the_dev_endpoints_are_gone(client, db, dev, riya, method, path):
    json = {"user_id": riya[0]["id"]} if method == "POST" else None
    assert client.request(method, path, json=json, headers=dev[1]).status_code == 404
    assert audit(db) == []


# ---------- a developer is an admin, and the dashboard can't touch one ----------


@pytest.mark.parametrize("path", ADMIN_GETS + ["/admin/hostels", "/admin/escalations"])
def test_a_developer_passes_every_admin_check(client, dev, path):
    assert client.get(path, headers=dev[1]).status_code == 200


def test_a_developer_can_make_changes_like_an_admin(client, dev, riya):
    r = client.post(
        "/admin/gates", json={"name": "Back Gate", "lat": 30.2, "lng": 77.9}, headers=dev[1]
    )
    assert r.status_code == 201, r.text
    r = client.post(f"/admin/users/{riya[0]['id']}/role", json={"role": "admin"}, headers=dev[1])
    assert r.status_code == 200 and r.json()["role"] == "admin"
    students = client.get("/admin/students?q=dev", headers=dev[1]).json()
    assert [(s["email"], s["role"]) for s in students] == [("dev@example.com", "developer")]


def test_a_developer_is_not_counted_as_the_last_admin(client, dev, admin):
    r = client.post(f"/admin/users/{admin[0]['id']}/role", json={"role": "student"}, headers=dev[1])
    assert (r.status_code, r.json()["detail"]) == (409, "Make someone else an admin first")


ADMIN_CHANGES = [
    ("POST", "/admin/users/{id}/role", {"role": "admin"}),
    ("POST", "/admin/users/{id}/role", {"role": "student"}),
    ("POST", "/admin/users/{id}/active", {"on": False}),
    ("POST", "/admin/users/{id}/active", {"on": True}),
    ("PATCH", "/admin/users/{id}", {"email": "new@example.com"}),
    ("DELETE", "/admin/users/{id}/invite", None),
    ("POST", "/admin/users/{id}/password-link", None),
]


@pytest.mark.parametrize(("method", "path", "body"), ADMIN_CHANGES)
def test_an_admin_cannot_change_a_developer(client, db, dev, admin, method, path, body):
    r = client.request(method, path.format(id=dev[0]["id"]), json=body, headers=admin[1])
    assert (r.status_code, r.json()["detail"]) == (403, LOCKED)
    row = db.execute(
        text("SELECT role, email, deactivated_at FROM users WHERE id = :i"), {"i": dev[0]["id"]}
    ).one()
    assert tuple(row) == ("developer", "dev@example.com", None)
    assert audit(db) == []


def test_another_developer_cannot_change_one_either(client, db, dev):
    _, other = signup(client, "rishi@example.com", "Rishi")
    make_developer(db, "rishi@example.com")
    r = client.post(f"/admin/users/{dev[0]['id']}/role", json={"role": "admin"}, headers=other)
    assert (r.status_code, r.json()["detail"]) == (403, LOCKED)


def test_an_admin_can_still_correct_a_developers_name(client, dev, admin):
    r = client.patch(f"/admin/users/{dev[0]['id']}", json={"name": "Dev E."}, headers=admin[1])
    assert r.status_code == 200 and (r.json()["name"], r.json()["role"]) == ("Dev E.", "developer")


def test_the_dashboard_never_grants_the_developer_role(client, db, admin, riya):
    r = client.post(
        f"/admin/users/{riya[0]['id']}/role", json={"role": "developer"}, headers=admin[1]
    )
    assert r.status_code == 422
    r = client.post(
        "/admin/people",
        json={"name": "New Dev", "role": "developer", "email": "newdev@example.com"},
        headers=admin[1],
    )
    assert r.status_code == 422
    r = client.post(
        "/admin/students/import",
        json={"csv": "name,email,role\nNew Dev,newdev@example.com,developer\n"},
        headers=admin[1],
    )
    [row] = r.json()["rows"]
    assert row["status"] == "error"
    assert db.execute(text("SELECT count(*) FROM users WHERE role = 'developer'")).scalar_one() == 0


@pytest.mark.parametrize("model", [RoleIn, PersonIn])
def test_input_schemas_reject_developer(model):
    fields = {"role": "developer"} if model is RoleIn else {"name": "X", "role": "developer"}
    with pytest.raises(ValidationError):
        model(**fields)


# ---------- the grant script, and the migration ----------


def load_script():
    spec = importlib.util.spec_from_file_location(
        "make_developer", Path(__file__).resolve().parents[1] / "scripts" / "make_developer.py"
    )
    script = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(script)
    return script


def test_make_developer_grants_the_role_and_audits_it(client, db, test_db_url, riya):
    script = load_script()
    assert "No account" in script.make_developer(test_db_url, "nobody@example.com")
    db.execute(text("UPDATE users SET email_verified_at = NULL WHERE email = 'riya@example.com'"))
    db.commit()
    assert "verified" in script.make_developer(test_db_url, "riya@example.com")
    db.execute(text("UPDATE users SET email_verified_at = now() WHERE email = 'riya@example.com'"))
    db.commit()
    assert client.get("/auth/me", headers=as_(riya[1], "admin")).status_code == 403

    assert script.make_developer(test_db_url, "riya@example.com") == (
        "riya@example.com is now a developer."
    )
    assert client.get("/auth/me", headers=as_(riya[1], "admin")).status_code == 200
    assert "already" in script.make_developer(test_db_url, "riya@example.com")
    rows = db.execute(text("SELECT actor_id, action, target FROM admin_audit")).all()
    assert [tuple(r) for r in rows] == [(None, "developer.grant", "riya@example.com (was student)")]


def test_make_developer_keeps_an_admin_to_run_the_campus(db, test_db_url, admin):
    script = load_script()
    assert "only admin" in script.make_developer(test_db_url, "admin@example.com")
    assert db.execute(text("SELECT role FROM users")).scalar_one() == "admin"


def test_the_migration_turns_developers_into_admins_on_downgrade(clean_db, test_db_url):
    cfg = alembic_config(test_db_url)
    with clean_db.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO users (name, email, password_hash, role) "
                "VALUES ('Dev', 'dev@example.com', 'x', 'developer')"
            )
        )
    command.downgrade(cfg, "0027")
    try:
        with clean_db.begin() as conn:
            assert conn.execute(text("SELECT role FROM users")).scalar_one() == "admin"
            with pytest.raises(IntegrityError, match="ck_users_user_role"):
                with conn.begin_nested():
                    conn.execute(text("UPDATE users SET role = 'developer'"))
    finally:
        command.upgrade(cfg, "head")
    with clean_db.begin() as conn:
        conn.execute(text("UPDATE users SET role = 'developer'"))  # allowed again
        assert conn.execute(text("SELECT role FROM users")).scalar_one() == "developer"
