"""Late follow-up: "are you OK?" at 30 min late, escalation to admins 10 min later without an
answer, and what admins see (contacts, warden, last known position, logged for the student)."""

import pytest
from sqlalchemy import text

from app.jobs.expiry import sweep
from app.push import MemoryPushSender
from tests.helpers import befriend, make_admin, share_with, signup
from tests.test_push import register_token

STUDENT_PHONE = "ExponentPushToken[riyaPhone0001]"
ADMIN_PHONE = "ExponentPushToken[wardenPhone01]"


@pytest.fixture
def push(client) -> MemoryPushSender:
    sender = MemoryPushSender()
    client.app.state.push = sender
    return sender


@pytest.fixture
def riya(client):
    headers = signup(client, "riya@geu.ac.in", "Riya")[1]
    client.patch(
        "/profile",
        json={
            "contacts": {
                "phone": "9876543210",
                "emergency_name": "Sunita",
                "emergency_relation": "Mother",
                "emergency_phone": "9123456789",
            }
        },
        headers=headers,
    )
    return headers


@pytest.fixture
def warden(client, db):
    headers = signup(client, "warden@geu.ac.in", "Warden")[1]
    make_admin(db, "warden@geu.ac.in")
    return headers


def run_sweep(client, push):
    state = client.app.state
    return client.portal.call(
        sweep, state.sessionmaker, state.hub, push, state.mailer, "https://lumiback.test"
    )


def late_by(db, minutes: int, alerted_minutes_ago: int | None = None) -> None:
    db.execute(
        text(
            "UPDATE outings SET left_at = now() - interval '3 hours', "
            "expected_return_at = now() - make_interval(mins => :m)"
        ),
        {"m": minutes},
    )
    if alerted_minutes_ago is not None:
        db.execute(
            text("UPDATE outings SET overdue_notified_at = now() - make_interval(mins => :a)"),
            {"a": alerted_minutes_ago},
        )
    db.commit()


def go_out(client, headers):
    r = client.post("/outings", json={"destination": "Rajpur Road"}, headers=headers)
    assert r.status_code == 201, r.text


def test_the_alert_reaches_a_student_who_muted_reminders(client, db, push, riya):
    register_token(client, riya, STUDENT_PHONE, muted=["return-reminders"])
    go_out(client, riya)
    late_by(db, 20)
    assert run_sweep(client, push).overdue_notified == 0  # within the grace period
    late_by(db, 31)
    assert run_sweep(client, push).overdue_notified == 1
    tokens, message = push.outbox[-1]
    assert tokens == [STUDENT_PHONE] and message.urgent
    assert "Are you OK?" in message.title
    assert run_sweep(client, push).overdue_notified == 0  # once per outing


def test_a_student_without_the_app_is_emailed_the_alert(client, db, push, riya):
    go_out(client, riya)  # signed in on the website only: no phone registered
    late_by(db, 31)
    mailer = client.app.state.mailer
    before = len(mailer.outbox)
    assert run_sweep(client, push).overdue_notified == 1
    assert push.outbox == []
    [mail] = mailer.outbox[before:]
    assert mail.to == "riya@geu.ac.in"
    assert "Are you OK?" in mail.subject
    assert "https://lumiback.test/home" in mail.body
    assert "You were due back at " in mail.body and (" AM" in mail.body or " PM" in mail.body)
    assert run_sweep(client, push).overdue_notified == 0  # once per outing
    assert len(mailer.outbox) == before + 1


def test_a_student_with_the_app_gets_a_push_not_an_email(client, db, push, riya):
    register_token(client, riya, STUDENT_PHONE)
    go_out(client, riya)
    late_by(db, 31)
    mailer = client.app.state.mailer
    before = len(mailer.outbox)
    run_sweep(client, push)
    assert push.outbox[-1][0] == [STUDENT_PHONE]
    assert len(mailer.outbox) == before


def test_old_records_follow_the_retention_setting(client, db, push, riya, warden):
    """Share views, outing requests and handled escalations are deleted with gate scans;
    an open escalation stays until an admin handles it."""
    from datetime import UTC, datetime

    _, arjun = signup(client, "arjun@geu.ac.in", "Arjun")
    befriend(client, riya, "arjun@geu.ac.in", arjun)
    share = share_with(client, riya, [client.get("/auth/me", headers=arjun).json()["id"]])
    fix = {"lat": 30.31, "lng": 78.03, "accuracy_m": 9}
    fix["recorded_at"] = datetime.now(UTC).isoformat()
    client.put(f"/sessions/{share['id']}/location", json=fix, headers=riya)
    go_out(client, riya)
    late_by(db, 41, alerted_minutes_ago=11)
    run_sweep(client, push)  # opens an escalation
    client.get("/admin/escalations", headers=warden)  # the admin's look is logged on the share
    assert db.execute(text("SELECT count(*) FROM access_log")).scalar_one() >= 1
    db.execute(text("UPDATE campus_settings SET scan_retention_days = 30"))
    db.execute(text("UPDATE escalations SET created_at = now() - interval '31 days'"))
    db.execute(text("UPDATE access_log SET viewed_at = now() - interval '31 days'"))
    db.execute(
        text(
            "INSERT INTO outing_requests (student_id, day, purpose, phone, emergency_name, "
            "emergency_relation, emergency_phone, status) "
            "SELECT id, current_date - 31, 'Old trip', '+919876543210', 'Sunita', 'Mother', "
            "'+919123456789', 'approved' FROM users WHERE email = 'riya@geu.ac.in'"
        )
    )
    db.commit()
    result = run_sweep(client, push)
    assert result.deleted_requests == 1
    assert result.deleted_views >= 1
    assert db.execute(text("SELECT count(*) FROM access_log")).scalar_one() == 0
    assert result.deleted_escalations == 0  # still open
    assert db.execute(text("SELECT count(*) FROM escalations")).scalar_one() == 1

    [e] = client.get("/admin/escalations", headers=warden).json()
    r = client.post(f"/admin/escalations/{e['id']}/resolve", json={"note": "OK"}, headers=warden)
    assert r.status_code == 204
    db.execute(text("UPDATE escalations SET created_at = now() - interval '31 days'"))
    db.commit()
    assert run_sweep(client, push).deleted_escalations == 1


def test_no_answer_escalates_to_admins_once(client, db, push, riya, warden):
    register_token(client, warden, ADMIN_PHONE)
    go_out(client, riya)
    late_by(db, 35, alerted_minutes_ago=5)
    assert run_sweep(client, push).escalated == 0  # still time to answer
    late_by(db, 41, alerted_minutes_ago=11)
    assert run_sweep(client, push).escalated == 1
    assert push.outbox[-1][0] == [ADMIN_PHONE] and push.outbox[-1][1].urgent
    mail = client.app.state.mailer.outbox[-1]
    assert mail.to == "warden@geu.ac.in"
    assert "https://lumiback.test/admin/escalations" in mail.body
    assert "Riya" not in mail.body  # names and numbers stay behind the sign-in
    assert run_sweep(client, push).escalated == 0  # never twice

    [e] = client.get("/admin/escalations", headers=warden).json()
    assert (e["name"], e["phone"], e["emergency_name"], e["emergency_phone"]) == (
        "Riya",
        "+919876543210",
        "Sunita",
        "+919123456789",
    )
    assert e["late_minutes"] >= 41 and e["late_reply"] is None and e["last_seen"] is None


def test_an_answer_stops_the_escalation(client, db, push, riya, warden):
    go_out(client, riya)
    late_by(db, 31)
    run_sweep(client, push)
    r = client.post("/outings/current/late-reply", json={"reply": "on_my_way"}, headers=riya)
    assert r.status_code == 200, r.text
    assert r.json()["late_reply"] == "on_my_way"
    late_by(db, 45, alerted_minutes_ago=14)
    assert run_sweep(client, push).escalated == 0


def test_tapping_in_stops_the_escalation(client, db, push, riya):
    go_out(client, riya)
    late_by(db, 41, alerted_minutes_ago=11)
    client.post("/outings/current/return", headers=riya)
    assert run_sweep(client, push).escalated == 0


def test_the_last_gate_scan_is_the_last_known_position(client, db, push, riya, warden):
    from tests.helpers import create_gate, kiosk_qr

    gate = create_gate(client, warden)
    r = client.post(
        "/gates/scan",
        json={
            "qr": kiosk_qr(client, gate["kiosk_token"]),
            "lat": 30.2687,
            "lng": 77.9947,
            "accuracy_m": 8,
        },
        headers=riya,
    )
    assert r.status_code == 200, r.text
    late_by(db, 41, alerted_minutes_ago=11)
    run_sweep(client, push)
    [e] = client.get("/admin/escalations", headers=warden).json()
    assert e["last_seen"]["kind"] == "gate" and e["last_seen"]["gate"] == "Main Gate"
    assert e["last_seen"]["lat"] is None  # gate scans never keep coordinates


def test_a_live_share_gives_the_position_and_logs_the_admin_read(client, db, push, riya, warden):
    _, arjun = signup(client, "arjun@geu.ac.in", "Arjun")
    befriend(client, riya, "arjun@geu.ac.in", arjun)
    me = client.get("/auth/me", headers=arjun).json()
    share = share_with(client, riya, [me["id"]])
    from datetime import UTC, datetime

    fix = {
        "lat": 30.31,
        "lng": 78.03,
        "accuracy_m": 9,
        "recorded_at": datetime.now(UTC).isoformat(),
    }
    assert (
        client.put(f"/sessions/{share['id']}/location", json=fix, headers=riya).status_code == 204
    )
    go_out(client, riya)
    late_by(db, 41, alerted_minutes_ago=11)
    run_sweep(client, push)

    [e] = client.get("/admin/escalations", headers=warden).json()
    assert (e["last_seen"]["kind"], e["last_seen"]["lat"]) == ("live", 30.31)
    log = client.get(f"/sessions/{share['id']}/access-log", headers=riya).json()
    assert [(x["kind"], x["viewer_name"], x["channel"]) for x in log] == [
        ("admin", "Warden (hostel office)", "admin")
    ]


def test_resolving_an_escalation(client, db, push, riya, warden):
    go_out(client, riya)
    late_by(db, 41, alerted_minutes_ago=11)
    run_sweep(client, push)
    [e] = client.get("/admin/escalations", headers=warden).json()
    r = client.post(
        f"/admin/escalations/{e['id']}/resolve",
        json={"note": "Called her mother: bus was late"},
        headers=warden,
    )
    assert r.status_code == 204
    assert client.get("/admin/escalations", headers=warden).json() == []
    [done] = client.get("/admin/escalations?state=all", headers=warden).json()
    assert (done["resolved_by"], done["note"]) == ("Warden", "Called her mother: bus was late")


def test_students_cannot_see_escalations(client, riya):
    assert client.get("/admin/escalations", headers=riya).status_code == 403


def test_replying_when_not_out(client, riya):
    r = client.post("/outings/current/late-reply", json={"reply": "safe"}, headers=riya)
    assert r.status_code == 404
