"""Deleting an account removes the person's data, and only with the password.

The hostel's record stays: the student's outings (and their escalations and corrections) are
detached from the account with a snapshot of the name and roll no., shown to the office as a
deleted account, and purged by the sweep once the campus retention period has passed since
the deletion. Deleting is refused while the student is out or a late escalation is open, and
for the last admin who can sign in."""

import csv
import io
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text
from starlette.websockets import WebSocketDisconnect

from app.jobs.expiry import sweep
from app.services.rules import ist_date
from tests.helpers import PASSWORD, befriend, ist_now_minutes, make_admin, share_with, signup
from tests.test_push import register_token

TABLES_WITH_USER_DATA = [
    "users",
    "outings",
    "share_sessions",
    "share_viewers",
    "locations",
    "contacts",
    "refresh_tokens",
    "access_log",
]
OUT_NOW = "You're out right now. Tap in or mark yourself back first, then delete your account."
ESCALATED = (
    "The hostel office is still following up your late return. "
    "Ask them to close it, then delete your account."
)
LAST_ADMIN = "Make someone else an admin first"


def counts(db) -> dict[str, int]:
    return {
        t: db.execute(text(f"SELECT count(*) FROM {t}")).scalar_one() for t in TABLES_WITH_USER_DATA
    }  # noqa: S608


def delete_account(client, headers, password: str = PASSWORD):
    return client.post("/auth/delete-account", json={"password": password}, headers=headers)


def go_out(client, headers) -> dict:
    r = client.post(
        "/outings",
        json={"expected_return_at": "2099-01-01T00:00:00+05:30", "destination": "Library"},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def come_back(client, headers) -> None:
    assert client.post("/outings/current/return", headers=headers).status_code == 200


def run_sweep(client):
    return client.portal.call(sweep, client.app.state.sessionmaker, client.app.state.hub)


def test_wrong_password_deletes_nothing(client, db):
    _, riya = signup(client, "riya@example.com", "Riya")
    before = counts(db)
    r = delete_account(client, riya, "not-my-password")
    assert r.status_code == 403
    assert counts(db) == before
    assert client.get("/auth/me", headers=riya).status_code == 200


def test_deleting_removes_the_account_and_everything_tied_to_it(client, db):
    riya_user, riya = signup(client, "riya@example.com", "Riya")
    arjun_user, arjun = signup(client, "arjun@example.com", "Arjun")
    befriend(client, riya, "arjun@example.com", arjun)
    befriend(client, arjun, "riya@example.com", riya)
    go_out(client, riya)
    come_back(client, riya)
    register_token(client, riya, "ExponentPushToken[riyaPhone00001]")
    s = share_with(client, riya, [arjun_user["id"]])
    fix = {"lat": 30.3, "lng": 78.0, "accuracy_m": 5, "recorded_at": datetime.now(UTC).isoformat()}
    client.put(f"/sessions/{s['id']}/location", json=fix, headers=riya)
    client.get(f"/sessions/{s['id']}/location", headers=arjun)  # an access-log row

    r = delete_account(client, riya)
    assert r.status_code == 204

    for table, user_column in [
        ("users", "id"),
        ("outings", "student_id"),
        ("share_sessions", "sharer_id"),
        ("contacts", "owner_id"),
        ("contacts", "contact_user_id"),
        ("refresh_tokens", "user_id"),
        ("push_tokens", "user_id"),
        ("gate_scans", "user_id"),
        ("outing_requests", "student_id"),
    ]:
        left = db.execute(
            text(f"SELECT count(*) FROM {table} WHERE {user_column} = :u"),  # noqa: S608
            {"u": riya_user["id"]},
        ).scalar_one()
        assert left == 0, table
    assert db.execute(text("SELECT count(*) FROM locations")).scalar_one() == 0
    assert db.execute(text("SELECT count(*) FROM access_log")).scalar_one() == 0
    assert db.execute(text("SELECT count(*) FROM push_tokens")).scalar_one() == 0
    # Arjun's own account is untouched.
    assert client.get("/auth/me", headers=arjun).json()["id"] == arjun_user["id"]
    # The deleted account's token is useless and the email can sign up again.
    assert client.get("/auth/me", headers=riya).status_code == 401


def test_viewers_of_a_live_share_are_cut_off(client):
    _, riya = signup(client, "riya@example.com", "Riya")
    arjun_user, arjun = signup(client, "arjun@example.com", "Arjun")
    befriend(client, riya, "arjun@example.com", arjun)
    s = share_with(client, riya, [arjun_user["id"]])

    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "auth", "token": arjun["Authorization"].removeprefix("Bearer ")})
        assert ws.receive_json()["type"] == "ready"
        ws.send_json({"type": "subscribe", "session_id": s["id"]})
        assert ws.receive_json()["type"] == "subscribed"

        delete_account(client, riya)

        assert ws.receive_json()["type"] == "ended"
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()


def test_password_guessing_is_rate_limited(client):
    _, riya = signup(client, "riya@example.com", "Riya")
    for _ in range(5):
        r = delete_account(client, riya, "guess")
        assert r.status_code == 403
    r = delete_account(client, riya)
    assert r.status_code == 429  # even the right password, once locked
    assert client.get("/auth/me", headers=riya).status_code == 200


def test_requires_sign_in(client):
    assert client.post("/auth/delete-account", json={"password": PASSWORD}).status_code == 401


# ---------- refused while the office still needs the account ----------


def test_refused_while_out(client, db):
    _, riya = signup(client, "riya@example.com", "Riya")
    outing = go_out(client, riya)
    # Refusals by policy don't count as password guesses: more than the guessing limit.
    for _ in range(6):
        r = delete_account(client, riya)
        assert r.status_code == 409, r.text
        assert r.json()["detail"] == OUT_NOW
    assert client.get("/outings/current", headers=riya).json()["id"] == outing["id"]
    # A wrong password is still a wrong password, out or not.
    assert delete_account(client, riya, "guess").status_code == 403

    come_back(client, riya)
    assert delete_account(client, riya).status_code == 204
    assert db.execute(text("SELECT count(*) FROM users")).scalar_one() == 0


@pytest.fixture
def office(client, db):
    headers = signup(client, "office@example.com", "Office")[1]
    make_admin(db, "office@example.com")
    return headers


def escalate(client, db) -> None:
    """The open outing becomes 41 min late with an unanswered alert; the sweep escalates it."""
    db.execute(
        text(
            "UPDATE outings SET left_at = now() - interval '3 hours', "
            "expected_return_at = now() - interval '41 minutes', "
            "overdue_notified_at = now() - interval '11 minutes'"
        )
    )
    db.commit()
    assert run_sweep(client).escalated == 1


def test_refused_while_a_late_escalation_is_open(client, db, office):
    _, riya = signup(client, "riya@example.com", "Riya")
    go_out(client, riya)
    escalate(client, db)
    come_back(client, riya)  # back, but the office hasn't closed the follow-up yet

    r = delete_account(client, riya)
    assert r.status_code == 409, r.text
    assert r.json()["detail"] == ESCALATED
    assert db.execute(text("SELECT count(*) FROM escalations")).scalar_one() == 1

    [e] = client.get("/admin/escalations", headers=office).json()
    resolved = client.post(
        f"/admin/escalations/{e['id']}/resolve", json={"note": "Back, fine"}, headers=office
    )
    assert resolved.status_code == 204
    assert delete_account(client, riya).status_code == 204
    # The handled escalation stays with the hostel's record, under the deleted account.
    [kept] = client.get("/admin/escalations?state=all", headers=office).json()
    assert kept["id"] == e["id"] and kept["name"] == "Riya (deleted account)"
    assert kept["email"] is None and kept["phone"] is None and kept["note"] == "Back, fine"


def test_refused_for_the_last_admin(client, db, office):
    r = delete_account(client, office)
    assert r.status_code == 409, r.text
    assert r.json()["detail"] == LAST_ADMIN
    assert client.get("/auth/me", headers=office).status_code == 200
    # An admin who hasn't set up their account can't run the campus: still the last one.
    db.execute(
        text(
            "INSERT INTO users (name, email, password_hash, role) "
            "VALUES ('Invited', 'invited@example.com', 'x', 'admin')"
        )
    )
    db.commit()
    assert delete_account(client, office).status_code == 409


def test_an_admin_can_delete_once_another_admin_is_left(client, db, office):
    _, other = signup(client, "second@example.com", "Second")
    make_admin(db, "second@example.com")
    assert delete_account(client, office).status_code == 204
    assert client.get("/auth/me", headers=other).json()["role"] == "admin"
    assert delete_account(client, other).status_code == 409  # now the last one


# ---------- the hostel's record stays ----------


def admin_rows(client, office, path: str) -> list[dict]:
    r = client.get(path, headers=office)
    assert r.status_code == 200, r.text
    return r.json()


def test_the_office_keeps_the_outing_with_a_snapshot(client, db, office):
    riya_user, riya = signup(client, "riya@example.com", "Riya")
    db.execute(text("UPDATE users SET roll_no = '22CS101' WHERE email = 'riya@example.com'"))
    db.commit()
    hostels = client.post(
        "/admin/hostels",
        json={
            "name": "Hostel A",
            "rule_set_id": next(
                s["id"]
                for s in client.get("/admin/rule-sets", headers=office).json()
                if s["is_default"]
            ),
        },
        headers=office,
    ).json()
    hostel_a = next(h["id"] for h in hostels if h["name"] == "Hostel A")
    assert client.patch("/profile", json={"hostel_id": hostel_a}, headers=riya).status_code == 200
    outing = go_out(client, riya)
    come_back(client, riya)
    # Back a little late, so it's also on tonight's late list.
    db.execute(
        text(
            "UPDATE outings SET left_at = now() - interval '2 hours', "
            "expected_return_at = returned_at - interval '1 minute'"
        )
    )
    db.commit()

    assert delete_account(client, riya).status_code == 204

    row = db.execute(
        text(
            "SELECT student_id, student_name, student_roll_no, detached_at IS NOT NULL, "
            "hostel_id::text FROM outings WHERE id = :id"
        ),
        {"id": outing["id"]},
    ).one()
    assert tuple(row) == (None, "Riya", "22CS101", True, hostel_a)
    gone = db.execute(text("SELECT count(*) FROM users WHERE id = :u"), {"u": riya_user["id"]})
    assert gone.scalar_one() == 0

    expected = ("Riya (deleted account)", "22CS101", None, None, "Hostel A")
    [back] = admin_rows(client, office, "/admin/outings?state=back")
    assert (back["name"], back["roll_no"], back["email"], back["student_id"], back["hostel"]) == (
        expected
    )
    assert back["id"] == outing["id"]
    if ist_now_minutes() > 2:  # the return time fell on today (IST)
        [late] = admin_rows(client, office, "/admin/late-today")
        assert late["id"] == outing["id"] and late["name"] == expected[0]
    today = ist_date(datetime.now(UTC) - timedelta(hours=2)).isoformat()
    r = client.get(f"/admin/outings.csv?from={today}&to={today}", headers=office)
    assert r.status_code == 200, r.text
    [_, line] = list(csv.reader(io.StringIO(r.text)))
    assert line[:3] == ["Riya (deleted account)", "", "22CS101"]
    # The office can still fix the record (nobody to notify).
    fixed = client.post(
        f"/admin/outings/{outing['id']}/correction",
        json={"kind": "return_time", "returned_at": back["returned_at"], "reason": "Hostel log"},
        headers=office,
    )
    assert fixed.status_code == 200, fixed.text
    assert fixed.json()["name"] == expected[0] and fixed.json()["in_via"] == "staff"


def test_detached_outings_stay_with_their_hostels_office(client, db, office):
    """A warden sees a deleted student's outing only for the hostel it happened in."""
    from tests.test_wardens import set_role

    default = next(
        s["id"] for s in client.get("/admin/rule-sets", headers=office).json() if s["is_default"]
    )
    ids = {}
    for name in ("A", "B"):
        body = {"name": f"Hostel {name}", "rule_set_id": default}
        made = client.post("/admin/hostels", json=body, headers=office).json()
        ids[name] = next(h["id"] for h in made if h["name"] == f"Hostel {name}")
    _, riya = signup(client, "riya@example.com", "Riya")
    client.patch("/profile", json={"hostel_id": ids["A"]}, headers=riya)
    _, wa = signup(client, "warden.a@example.com", "Warden A")
    _, wb = signup(client, "warden.b@example.com", "Warden B")
    assert set_role(client, office, "warden.a@example.com", "warden", [ids["A"]]).status_code == 200
    assert set_role(client, office, "warden.b@example.com", "warden", [ids["B"]]).status_code == 200
    go_out(client, riya)
    come_back(client, riya)
    assert delete_account(client, riya).status_code == 204

    assert [o["name"] for o in admin_rows(client, wa, "/admin/outings?state=back")] == [
        "Riya (deleted account)"
    ]
    assert admin_rows(client, wb, "/admin/outings?state=back") == []


def test_unused_requests_go_and_the_approval_behind_an_outing_stays(client, db, office):
    riya_user, riya = signup(client, "riya@example.com", "Riya")
    go_out(client, riya)
    come_back(client, riya)
    for day, status in (("current_date", "approved"), ("current_date - 1", "pending")):
        db.execute(
            text(
                "INSERT INTO outing_requests (student_id, day, purpose, phone, emergency_name, "
                "emergency_relation, emergency_phone, status) "
                f"SELECT id, {day}, 'Trip', '+919876543210', 'Sunita', 'Mother', "  # noqa: S608
                "'+919123456789', :s FROM users WHERE email = 'riya@example.com'"
            ),
            {"s": status},
        )
    used = db.execute(text("SELECT id FROM outing_requests WHERE status = 'approved'")).scalar_one()
    db.execute(text("UPDATE outings SET request_id = :r"), {"r": used})
    db.execute(text("UPDATE outing_requests SET used_at = now() WHERE id = :r"), {"r": used})
    db.commit()

    assert delete_account(client, riya).status_code == 204
    left = db.execute(text("SELECT id, student_id FROM outing_requests")).all()
    assert [tuple(r) for r in left] == [(used, None)]
    [back] = admin_rows(client, office, "/admin/outings?state=back")
    assert back["on_request"] is True
    # Detached requests never show up in a day's queue (nobody to decide for).
    assert admin_rows(client, office, "/admin/requests") == []


DETACHED_AGO = text(
    "UPDATE outings SET detached_at = now() - make_interval(days => :days) WHERE student_id IS NULL"
)


def test_the_sweep_purges_detached_records_after_the_retention_period(client, db, office):
    _, riya = signup(client, "riya@example.com", "Riya")
    go_out(client, riya)
    escalate(client, db)
    come_back(client, riya)
    [e] = client.get("/admin/escalations", headers=office).json()
    client.post(f"/admin/escalations/{e['id']}/resolve", json={"note": "ok"}, headers=office)
    _, arjun = signup(client, "arjun@example.com", "Arjun")
    go_out(client, arjun)
    come_back(client, arjun)
    assert delete_account(client, riya).status_code == 204
    # The trip itself was long ago: the period runs from the deletion, not from the trip.
    db.execute(
        text(
            "UPDATE outings SET left_at = left_at - interval '400 days', "
            "expected_return_at = expected_return_at - interval '400 days', "
            "returned_at = returned_at - interval '400 days' WHERE student_id IS NULL"
        )
    )
    db.execute(text("UPDATE escalations SET created_at = now() - interval '10 days'"))
    db.execute(DETACHED_AGO, {"days": 179})
    db.commit()

    result = run_sweep(client)
    assert result.deleted_detached_outings == 0
    assert db.execute(text("SELECT count(*) FROM outings")).scalar_one() == 2
    assert db.execute(text("SELECT count(*) FROM escalations")).scalar_one() == 1

    db.execute(DETACHED_AGO, {"days": 181})
    db.commit()
    result = run_sweep(client)
    assert result.deleted_detached_outings == 1
    # Only the deleted account's outing (and its escalation) went; Arjun's stays.
    owners = db.execute(text("SELECT student_id IS NULL FROM outings")).scalars().all()
    assert owners == [False]
    assert db.execute(text("SELECT count(*) FROM escalations")).scalar_one() == 0


def test_the_sweep_follows_the_campus_retention_setting(client, db, office):
    _, riya = signup(client, "riya@example.com", "Riya")
    go_out(client, riya)
    come_back(client, riya)
    assert delete_account(client, riya).status_code == 204
    db.execute(text("UPDATE campus_settings SET scan_retention_days = 30"))
    db.execute(text("UPDATE outings SET detached_at = now() - interval '29 days'"))
    db.commit()
    assert run_sweep(client).deleted_detached_outings == 0
    db.execute(text("UPDATE outings SET detached_at = now() - interval '31 days'"))
    db.commit()
    assert run_sweep(client).deleted_detached_outings == 1
    assert db.execute(text("SELECT count(*) FROM outings")).scalar_one() == 0


def test_a_pending_correction_ask_is_withdrawn_with_the_account(client, db, office):
    _, riya = signup(client, "riya@example.com", "Riya")
    outing = go_out(client, riya)
    come_back(client, riya)
    r = client.post(
        f"/outings/{outing['id']}/correction",
        json={"kind": "cancel", "reason": "Tapped by mistake"},
        headers=riya,
    )
    assert r.status_code == 201, r.text
    assert delete_account(client, riya).status_code == 204
    status = db.execute(text("SELECT status FROM outing_corrections")).scalar_one()
    assert status == "cancelled"
    assert admin_rows(client, office, "/admin/corrections")["asks"] == []
