"""Wave 2 alerts: the outbox (saved with their cause, sent after, retried, never twice),
escalation follow-up (claim, call log, re-alerts, hand-over to the head wardens), request
reminders and the backup approver, calling the office, office notices, and the Help button.

Two hostels: Anna (A) and Bina (B); a warden of each, a head warden and an admin. The warden
of A never sees or touches anything of B's, and the other way round.
"""

import asyncio
import json
import time

import httpx
import pytest
from sqlalchemy import text

from app.email import Email, MemoryMailer
from app.jobs.expiry import sweep
from app.models import OutboxMode
from app.push import MemoryPushSender, PushMessage, SendResult
from app.security.rate_limit import Limit
from app.services import accounts, escalations, outbox
from tests.helpers import PASSWORD, befriend, make_admin, set_rules, share_with, signup
from tests.test_email import _resend_mailer
from tests.test_view_as import make_developer

WARDEN_A = "ExponentPushToken[wardenAphone01]"
WARDEN_B = "ExponentPushToken[wardenBphone01]"
HEAD = "ExponentPushToken[headWardenPh01]"
ADMIN = "ExponentPushToken[adminPhone0001]"
ANNA = "ExponentPushToken[annaPhone00001]"
BINA = "ExponentPushToken[binaPhone00001]"
FRIEND = "ExponentPushToken[friendPhone001]"
FORM = {
    "purpose": "Shopping at Pacific Mall",
    "phone": "98765 43210",
    "emergency_name": "Sunita Sharma",
    "emergency_relation": "Mother",
    "emergency_phone": "+91-91234-56789",
}
FIX = {"lat": 30.31234, "lng": 78.03456, "accuracy_m": 12}


class Push(MemoryPushSender):
    """Records sends; `down` makes every send fail as a dead push service would."""

    down: bool = False

    async def send(self, tokens, message):
        if self.down:
            self.outbox.append((tokens, message))
            return SendResult(failed=set(tokens))
        return await super().send(tokens, message)


class Mailer(MemoryMailer):
    """Records emails; fails the first `failures` sends."""

    def __init__(self) -> None:
        super().__init__()
        self.failures = 0

    async def send(self, email: Email) -> None:
        if self.failures:
            self.failures -= 1
            raise RuntimeError("smtp down")
        await super().send(email)


@pytest.fixture(autouse=True)
def many_sign_ups(monkeypatch):
    """These tests sign up more people than one IP may in an hour (5)."""
    monkeypatch.setattr("app.api.auth.REGISTER_PER_IP", Limit(max_hits=100, window_seconds=3600))


@pytest.fixture
def push(client) -> Push:
    sender = Push()
    client.app.state.push = sender
    return sender


@pytest.fixture
def mailer(client) -> Mailer:
    m = Mailer()
    client.app.state.mailer = m
    return m


def token(client, headers, value):
    r = client.post(
        "/devices/push-token", json={"token": value, "platform": "android"}, headers=headers
    )
    assert r.status_code == 204, r.text


def user_id(client, admin, email):
    return client.get("/admin/users", params={"q": email}, headers=admin).json()[0]["id"]


def staff(client, admin, email, name, role, hostel_ids=()):
    headers = signup(client, email, name)[1]
    r = client.post(
        f"/admin/users/{user_id(client, admin, email)}/role",
        json={"role": role, "hostel_ids": list(hostel_ids)},
        headers=admin,
    )
    assert r.status_code == 200, r.text
    return headers


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


@pytest.fixture
def office(client, admin, hostels):
    """{"A": warden of A, "B": warden of B, "head": head warden}, each with a phone."""
    out = {
        "A": staff(client, admin, "warden.a@geu.ac.in", "Warden A", "warden", [hostels["A"]]),
        "B": staff(client, admin, "warden.b@geu.ac.in", "Warden B", "warden", [hostels["B"]]),
        "head": staff(client, admin, "head@geu.ac.in", "Head Warden", "head_warden"),
    }
    for who, phone in (("A", WARDEN_A), ("B", WARDEN_B), ("head", HEAD)):
        token(client, out[who], phone)
    token(client, admin, ADMIN)
    return out


def student(client, email, name, hostel_id, phone=None):
    headers = signup(client, email, name)[1]
    r = client.patch("/profile", json={"hostel_id": hostel_id}, headers=headers)
    assert r.status_code == 200, r.text
    if phone:
        token(client, headers, phone)
    return headers


@pytest.fixture
def anna(client, hostels):
    return student(client, "anna@geu.ac.in", "Anna", hostels["A"], ANNA)


@pytest.fixture
def bina(client, hostels):
    return student(client, "bina@geu.ac.in", "Bina", hostels["B"], BINA)


def run_sweep(client, sender=None):
    state = client.app.state
    return client.portal.call(
        sweep,
        state.sessionmaker,
        state.hub,
        sender if sender is not None else state.push,
        state.mailer,
        "https://lumiback.test",
    )


def go_out(client, headers):
    r = client.post("/outings", json={"destination": "Rajpur Road"}, headers=headers)
    assert r.status_code == 201, r.text


def sent_to(push, value) -> list[PushMessage]:
    return [m for tokens, m in push.outbox if value in tokens]


def mail_to(mailer, address) -> list[Email]:
    """Alerts emailed to `address` (outbox emails carry a key; sign-up codes don't)."""
    return [m for m in mailer.outbox if m.to == address and m.idempotency_key]


def escalate(client, db, push, headers) -> str:
    """The student goes out, is 41 min late with no answer: an escalation opens."""
    go_out(client, headers)
    db.execute(
        text(
            "UPDATE outings SET left_at = now() - interval '3 hours', "
            "expected_return_at = now() - interval '41 minutes', "
            "overdue_notified_at = now() - interval '11 minutes' WHERE returned_at IS NULL"
        )
    )
    db.commit()
    assert run_sweep(client).escalated == 1
    push.outbox.clear()
    return db.execute(text("SELECT id FROM escalations ORDER BY created_at DESC")).scalar_one()


def opened_ago(db, minutes, realerted=None):
    db.execute(
        text(
            "UPDATE escalations SET created_at = now() - make_interval(mins => :m), "
            "realerted_at = CASE WHEN CAST(:r AS integer) IS NULL THEN realerted_at "
            "ELSE now() - make_interval(mins => CAST(:r AS integer)) END"
        ),
        {"m": minutes, "r": realerted},
    )
    db.commit()


def rows(db):
    return db.execute(
        text("SELECT key, kind, mode, sent_at, failed_at, payload, attempts FROM alert_outbox")
    ).all()


def audit(db, action):
    return db.execute(
        text("SELECT target FROM admin_audit WHERE action = :a ORDER BY id"), {"a": action}
    ).all()


# ---------- the outbox ----------


LATE_31 = (
    "UPDATE outings SET left_at = now() - interval '3 hours', "
    "expected_return_at = now() - interval '31 minutes'"
)


def test_a_late_alert_is_saved_with_the_outing_and_sent_after(client, db, push, anna):
    go_out(client, anna)
    db.execute(text(LATE_31))
    db.commit()
    # No sender (e.g. the process died right after the commit): the alert waits in the outbox.
    state = client.app.state
    result = client.portal.call(sweep, state.sessionmaker, state.hub, None, None, "")
    assert result.overdue_notified == 1
    [row] = rows(db)
    assert (row.kind, row.mode, row.sent_at) == ("late_alert", "push_or_email", None)
    assert row.payload["push"]["urgent"] is True
    # The next sweep sends it, once, and forgets the message.
    assert run_sweep(client).alerts.sent == 1
    assert [m.title for m in sent_to(push, ANNA)] == ["You're 31 min late. Are you OK?"]
    [row] = rows(db)
    assert row.sent_at is not None and row.payload == {}
    assert run_sweep(client).alerts.sent == 0
    assert len(sent_to(push, ANNA)) == 1


def test_a_failed_push_is_retried_with_backoff_not_lost(client, db, push, office, anna):
    push.down = True
    escalate(client, db, push, anna)
    pushes = [r for r in rows(db) if r.mode == "push"]
    assert pushes and all(r.sent_at is None for r in pushes)
    # The first push failed, so the pass stopped trying push: the rest wait, untried.
    assert sorted(r.attempts for r in pushes) == [0] * (len(pushes) - 1) + [1]
    waits = db.execute(
        text(
            "SELECT last_error, next_attempt_at - now() > interval '20 seconds' "
            "FROM alert_outbox WHERE mode = 'push' AND attempts = 1"
        )
    ).all()
    assert all(error == "push failed" and later for error, later in waits)
    assert run_sweep(client).alerts.sent == 0  # still down: nothing went
    # A down sender still records each failed try, and which row a pass tries first among
    # equals isn't fixed: forget the failed tries so only real sends are counted.
    push.outbox.clear()
    push.down = False
    db.execute(text("UPDATE alert_outbox SET next_attempt_at = now()"))
    db.commit()
    run_sweep(client)
    assert len(sent_to(push, HEAD)) == 1 and sent_to(push, HEAD)[0].urgent
    assert all(r.sent_at is not None for r in rows(db))


def test_a_failed_email_is_retried_with_the_same_idempotency_key(
    client, db, push, mailer, office, anna
):
    mailer.failures = 100
    escalate(client, db, push, anna)
    emails = [r for r in rows(db) if r.mode == "email"]
    assert emails and all(r.sent_at is None for r in emails)
    mailer.failures = 0
    db.execute(text("UPDATE alert_outbox SET next_attempt_at = now()"))
    db.commit()
    run_sweep(client)
    keys = {r.key for r in rows(db) if r.mode == "email"}
    alerts = [m for m in mailer.outbox if m.idempotency_key]  # not the sign-up codes
    assert {m.idempotency_key for m in alerts} == keys
    assert len(alerts) == len(keys)  # one each


def test_after_the_last_try_it_is_given_up_and_emptied(client, db, push, office, anna):
    push.down = True
    escalate(client, db, push, anna)
    db.execute(
        text("UPDATE alert_outbox SET attempts = :n WHERE mode = 'push'"),
        {"n": outbox.MAX_ATTEMPTS - 1},
    )
    pushes = [r for r in rows(db) if r.mode == "push"]
    for _ in pushes:  # one push try a pass while push is down
        db.execute(text("UPDATE alert_outbox SET next_attempt_at = now() WHERE failed_at IS NULL"))
        db.commit()
        run_sweep(client)
    for r in (r for r in rows(db) if r.mode == "push"):
        assert r.failed_at is not None and r.payload == {} and r.sent_at is None


def test_the_same_alert_twice_is_one_row(client, db):
    async def twice():
        async with client.app.state.sessionmaker() as session:
            ids = [
                await outbox.enqueue(
                    session,
                    key="test:once",
                    kind="test",
                    mode=OutboxMode.EMAIL,
                    email=Email("a@example.com", "Subject", "Body"),
                )
                for _ in range(2)
            ]
            await session.commit()
            return ids

    first, second = client.portal.call(twice)
    assert first is not None and second is None
    assert len(rows(db)) == 1


def test_a_claimed_alert_is_not_sent_by_a_second_sender(client, db, push, mailer, office, anna):
    """Two senders at once (the sweep and a background task): the lease keeps one out."""
    push.down = True
    escalate(client, db, push, anna)
    db.execute(text("UPDATE alert_outbox SET next_attempt_at = now(), sent_at = NULL"))
    db.commit()
    state = client.app.state
    claimed = client.portal.call(outbox._claim, state.sessionmaker, None)
    assert claimed is not None
    sent = client.portal.call(outbox.deliver, state.sessionmaker, push, mailer, [claimed.id])
    assert sent == outbox.Delivery()  # leased: nobody else may send it


def test_sent_alerts_are_deleted_after_a_week(client, db, push, anna):
    go_out(client, anna)
    db.execute(text(LATE_31))
    db.commit()
    run_sweep(client)
    db.execute(text("UPDATE alert_outbox SET sent_at = now() - interval '8 days'"))
    db.commit()
    assert run_sweep(client).deleted_alerts == 1
    assert rows(db) == []


def test_resend_gets_the_idempotency_key():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["key"] = request.headers.get("idempotency-key")
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"id": "abc"})

    email = Email("riya@geu.ac.in", "Subject", "Body", idempotency_key="late:123")
    asyncio.run(_resend_mailer(handler).send(email))
    assert seen["key"] == "late:123"
    assert "idempotency_key" not in seen["body"]


# ---------- escalation follow-up ----------


def test_unclaimed_it_is_re_alerted_to_its_hostel_then_handed_over(
    client, db, push, office, anna, bina
):
    escalate(client, db, push, anna)
    assert run_sweep(client).followed_up == 0  # just opened
    opened_ago(db, 16)
    assert run_sweep(client).followed_up == 1
    [m] = sent_to(push, WARDEN_A)
    assert m.urgent and m.title == "A late student still needs follow-up"
    assert sent_to(push, HEAD) == [] and sent_to(push, WARDEN_B) == []
    assert run_sweep(client).followed_up == 0  # the next one is 15 min after this
    opened_ago(db, 25, realerted=16)
    assert run_sweep(client).followed_up == 1
    assert len(sent_to(push, WARDEN_A)) == 2
    # 30 min unclaimed: the head wardens take over (the admin isn't one).
    push.outbox.clear()
    opened_ago(db, 31, realerted=6)
    assert run_sweep(client).followed_up == 1
    [m] = sent_to(push, HEAD)
    assert m.title == "A late student needs you to take over" and "30 min" in m.body
    assert sent_to(push, WARDEN_A) == [] and sent_to(push, ADMIN) == []
    assert db.execute(text("SELECT handed_over_at IS NOT NULL FROM escalations")).scalar_one()
    # After the hand-over, re-alerts go to the head wardens.
    opened_ago(db, 47, realerted=16)
    run_sweep(client)
    assert len(sent_to(push, HEAD)) == 2 and sent_to(push, WARDEN_A) == []
    [e] = client.get("/admin/escalations", headers=office["head"]).json()
    assert e["realerts"] == 3 and e["handed_over_at"] is not None


def test_a_claim_stops_the_re_alerts(client, db, push, office, anna):
    e_id = escalate(client, db, push, anna)
    r = client.post(f"/admin/escalations/{e_id}/claim", headers=office["A"])
    assert r.status_code == 204, r.text
    [e] = client.get("/admin/escalations", headers=office["A"]).json()
    assert (e["claimed_by"], e["claimed_by_me"]) == ("Warden A", True)
    [e] = client.get("/admin/escalations", headers=office["head"]).json()
    assert e["claimed_by_me"] is False
    opened_ago(db, 45)
    assert run_sweep(client).followed_up == 0
    assert push.outbox == []
    assert len(audit(db, "escalation:claim")) == 1
    # Claiming again is a no-op; someone else's claim stays theirs.
    assert client.post(f"/admin/escalations/{e_id}/claim", headers=office["A"]).status_code == 204
    assert len(audit(db, "escalation:claim")) == 1
    r = client.post(f"/admin/escalations/{e_id}/claim", headers=office["head"])
    assert (r.status_code, r.json()["detail"]) == (409, "Warden A is already on it")


def test_a_released_claim_starts_the_re_alerts_again(
    client, db, push, admin, hostels, office, anna
):
    e_id = escalate(client, db, push, anna)
    other = staff(client, admin, "warden.a2@geu.ac.in", "Warden A2", "warden", [hostels["A"]])
    client.post(f"/admin/escalations/{e_id}/claim", headers=office["A"])
    # Another warden of the hostel can't take it back; a head warden can.
    r = client.delete(f"/admin/escalations/{e_id}/claim", headers=other)
    assert r.status_code == 409
    r = client.delete(f"/admin/escalations/{e_id}/claim", headers=office["head"])
    assert r.status_code == 204
    assert audit(db, "escalation:release") == [(str(e_id),)]
    [e] = client.get("/admin/escalations", headers=office["A"]).json()
    assert e["claimed_by"] is None


def test_another_hostels_warden_cannot_claim_release_or_log(client, db, push, office, anna):
    e_id = escalate(client, db, push, anna)
    b = office["B"]
    assert client.post(f"/admin/escalations/{e_id}/claim", headers=b).status_code == 404
    assert client.delete(f"/admin/escalations/{e_id}/claim", headers=b).status_code == 404
    r = client.post(f"/admin/escalations/{e_id}/calls", json={"outcome": "no_answer"}, headers=b)
    assert r.status_code == 404
    assert db.execute(text("SELECT claimed_by FROM escalations")).scalar_one() is None
    assert db.execute(text("SELECT count(*) FROM escalation_calls")).scalar_one() == 0


def test_students_cannot_follow_up(client, db, push, office, anna):
    e_id = escalate(client, db, push, anna)
    assert client.post(f"/admin/escalations/{e_id}/claim", headers=anna).status_code == 403


def test_a_logged_call_is_listed_and_claims_it(client, db, push, office, anna):
    e_id = escalate(client, db, push, anna)
    r = client.post(
        f"/admin/escalations/{e_id}/calls",
        json={"outcome": "reached_contact", "note": "  Mother says she is on the way  "},
        headers=office["A"],
    )
    assert r.status_code == 201, r.text
    assert (r.json()["by"], r.json()["note"]) == ("Warden A", "Mother says she is on the way")
    client.post(
        f"/admin/escalations/{e_id}/calls", json={"outcome": "no_answer"}, headers=office["head"]
    )
    [e] = client.get("/admin/escalations", headers=office["A"]).json()
    assert e["claimed_by"] == "Warden A"
    assert [(c["by"], c["outcome"]) for c in e["calls"]] == [
        ("Warden A", "reached_contact"),
        ("Head Warden", "no_answer"),
    ]
    bad = client.post(
        f"/admin/escalations/{e_id}/calls",
        json={"outcome": "no_answer", "note": "line\nbreak"},
        headers=office["A"],
    )
    assert bad.status_code == 422
    client.post(f"/admin/escalations/{e_id}/resolve", json={}, headers=office["A"])
    r = client.post(
        f"/admin/escalations/{e_id}/calls", json={"outcome": "no_answer"}, headers=office["A"]
    )
    assert (r.status_code, r.json()["detail"]) == (409, "This was already handled")
    assert client.post(f"/admin/escalations/{e_id}/claim", headers=office["A"]).status_code == 409


def test_follow_up_is_read_only_while_viewing_as(client, db, push, office, anna):
    e_id = escalate(client, db, push, anna)
    dev = signup(client, "dev@example.com", "Dev")[1]
    make_developer(db, "dev@example.com")
    viewing = {**dev, "X-View-As-Role": "warden"}
    for method, path, body in (
        ("post", f"/admin/escalations/{e_id}/claim", None),
        ("post", f"/admin/escalations/{e_id}/calls", {"outcome": "no_answer"}),
        ("post", "/admin/notices", {"message": "Come back"}),
    ):
        r = client.request(method.upper(), path, json=body, headers=viewing)
        assert (r.status_code, r.json()["detail"]) == (
            403,
            "Read-only while viewing as another role",
        )
    assert db.execute(text("SELECT claimed_by FROM escalations")).scalar_one() is None


# ---------- the timings ----------


def test_admins_set_the_timings(client, db, admin, office):
    got = client.get("/admin/settings", headers=admin).json()
    assert [got[k] for k in ("request_remind_minutes", "request_backup_minutes")] == [15, 30]
    assert [got[k] for k in ("escalation_realert_minutes", "escalation_takeover_minutes")] == [
        15,
        30,
    ]
    body = {"scan_retention_days": 180, "escalation_realert_minutes": 5}
    r = client.put("/admin/settings", json=body, headers=admin)
    assert r.status_code == 200 and r.json()["escalation_realert_minutes"] == 5
    assert "re-alert 5 min" in audit(db, "settings")[-1].target
    # Left out: kept.
    r = client.put("/admin/settings", json={"scan_retention_days": 180}, headers=admin)
    assert r.json()["escalation_realert_minutes"] == 5
    assert r.json()["request_remind_minutes"] == 15
    for bad in (4, 241):
        body = {"scan_retention_days": 180, "request_remind_minutes": bad}
        assert client.put("/admin/settings", json=body, headers=admin).status_code == 422
    body = {"scan_retention_days": 180, "request_remind_minutes": 20}
    for who in (office["A"], office["head"]):
        assert client.put("/admin/settings", json=body, headers=who).status_code == 403


def test_the_sweep_uses_the_admins_timings(client, db, push, admin, office, anna):
    client.put(
        "/admin/settings",
        json={"scan_retention_days": 180, "escalation_realert_minutes": 5},
        headers=admin,
    )
    escalate(client, db, push, anna)
    opened_ago(db, 6)
    assert run_sweep(client).followed_up == 1


# ---------- request reminders and the backup approver ----------


def send_request(client, db, headers):
    set_rules(db, "open", needs_form=True)
    r = client.post("/outings/request", json=FORM, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def asked_ago(db, minutes):
    db.execute(
        text("UPDATE outing_requests SET created_at = now() - make_interval(mins => :m)"),
        {"m": minutes},
    )
    db.commit()


def test_a_waiting_request_reminds_its_wardens_then_the_head_warden(client, db, push, office, anna):
    send_request(client, db, anna)
    push.outbox.clear()
    asked_ago(db, 10)
    assert run_sweep(client).reminded_requests == 0
    asked_ago(db, 16)
    assert run_sweep(client).reminded_requests == 1
    [m] = sent_to(push, WARDEN_A)
    assert m.title == "An outing request is waiting" and "Anna" in m.body and not m.urgent
    assert sent_to(push, HEAD) == [] and sent_to(push, WARDEN_B) == []
    assert run_sweep(client).reminded_requests == 0  # once
    asked_ago(db, 31)
    assert run_sweep(client).reminded_requests == 1
    [m] = sent_to(push, HEAD)
    assert m.title == "An outing request needs a backup decision"
    assert len(sent_to(push, WARDEN_A)) == 1
    assert run_sweep(client).reminded_requests == 0
    # The head warden may decide it.
    req = client.get("/admin/requests", headers=office["head"]).json()[0]
    r = client.post(
        f"/admin/requests/{req['id']}/decision", json={"approve": True}, headers=office["head"]
    )
    assert r.status_code == 200, r.text


def test_a_decided_request_is_not_reminded(client, db, push, office, anna):
    request_id = send_request(client, db, anna)
    client.post(
        f"/admin/requests/{request_id}/decision", json={"approve": False}, headers=office["A"]
    )
    asked_ago(db, 31)
    assert run_sweep(client).reminded_requests == 0


def test_a_warden_without_the_app_is_emailed_without_the_name(
    client, db, push, mailer, admin, hostels, anna
):
    staff(client, admin, "warden.a@geu.ac.in", "Warden A", "warden", [hostels["A"]])
    send_request(client, db, anna)
    asked_ago(db, 16)
    run_sweep(client)
    [mail] = mail_to(mailer, "warden.a@geu.ac.in")
    assert "waited 16 minutes" in mail.subject and "Anna" not in mail.body
    assert "https://lumiback.test/admin/requests" in mail.body


# ---------- calling the office ----------


@pytest.fixture
def numbered(client, office, hostels):
    r = client.patch(
        f"/admin/hostels/{hostels['A']}/contact",
        json={"warden_name": "Mr Rawat", "warden_phone": "98765 11111"},
        headers=office["A"],
    )
    assert r.status_code == 200, r.text


def test_a_student_who_is_out_sees_the_office_number(client, numbered, anna, bina):
    go_out(client, anna)
    office = client.get("/outings/current", headers=anna).json()["office"]
    assert (office["hostel"], office["name"]) == ("Hostel A", "Mr Rawat")
    assert office["phone"].endswith("9876511111")
    go_out(client, bina)
    office = client.get("/outings/current", headers=bina).json()["office"]
    assert (office["hostel"], office["phone"]) == ("Hostel B", None)  # no number: call me


def test_ask_the_office_to_call_tells_the_hostels_wardens(client, db, push, mailer, office, anna):
    r = client.post("/outings/current/call-me", headers=anna)
    assert r.status_code == 404  # not out
    go_out(client, anna)
    r = client.post("/outings/current/call-me", headers=anna)
    assert (r.status_code, r.json()["notified"]) == (202, 1)
    [m] = sent_to(push, WARDEN_A)
    anna_id = client.get("/auth/me", headers=anna).json()["id"]
    assert m.urgent and "Anna" in m.title and m.url == f"/office/student/{anna_id}"
    assert sent_to(push, WARDEN_B) == [] and sent_to(push, HEAD) == []
    for _ in range(2):
        assert client.post("/outings/current/call-me", headers=anna).status_code == 202
    assert client.post("/outings/current/call-me", headers=anna).status_code == 429


# ---------- office notices ----------


def test_a_warden_sends_a_notice_to_their_hostels_students_who_are_out(
    client, db, push, mailer, office, hostels, anna, bina
):
    go_out(client, anna)
    go_out(client, bina)
    r = client.post(
        "/admin/notices", json={"message": "The gate closes at 9 tonight"}, headers=office["A"]
    )
    assert (r.status_code, r.json()) == (200, {"sent": 1})
    [m] = sent_to(push, ANNA)
    assert (m.title, m.body, m.urgent) == (
        "Notice from the hostel office",
        "The gate closes at 9 tonight",
        False,
    )
    assert sent_to(push, BINA) == []
    [(target,)] = audit(db, "notice:send")
    assert target == "1 out, all their hostels"  # who and where; the text went to the students
    # Another hostel is a 404; students can't send.
    body = {"message": "Come back", "hostel_id": hostels["B"]}
    assert client.post("/admin/notices", json=body, headers=office["A"]).status_code == 404
    assert client.post("/admin/notices", json=body, headers=anna).status_code == 403
    for bad in ("", " ", "a" + chr(0) + "b", "x" * 201):
        r = client.post("/admin/notices", json={"message": bad}, headers=office["A"])
        assert r.status_code == 422


def test_a_head_warden_recalls_every_student_who_is_out(
    client, db, push, office, hostels, anna, bina
):
    go_out(client, anna)
    go_out(client, bina)
    r = client.post(
        "/admin/notices",
        json={"message": "Come back now, the road is closed", "recall": True},
        headers=office["head"],
    )
    assert r.json() == {"sent": 2}
    for phone in (ANNA, BINA):
        [m] = sent_to(push, phone)
        assert m.urgent and m.title == "Come back to the hostel now"
    assert len(audit(db, "notice:recall")) == 1
    # One hostel only.
    r = client.post(
        "/admin/notices",
        json={"message": "Hostel B only", "hostel_id": hostels["B"]},
        headers=office["head"],
    )
    assert r.json() == {"sent": 1} and len(sent_to(push, BINA)) == 2


def test_a_student_without_the_app_is_emailed_the_notice(client, db, push, mailer, office, hostels):
    carl = student(client, "carl@geu.ac.in", "Carl", hostels["A"])
    go_out(client, carl)
    client.post("/admin/notices", json={"message": "Bring your ID card"}, headers=office["A"])
    [mail] = mail_to(mailer, "carl@geu.ac.in")
    assert "Bring your ID card" in mail.body


# ---------- the help button ----------


@pytest.fixture
def friend(client, anna):
    _, headers = signup(client, "friend@geu.ac.in", "Friend")
    token(client, headers, FRIEND)
    befriend(client, anna, "friend@geu.ac.in", headers)
    share_with(client, anna, [client.get("/auth/me", headers=headers).json()["id"]])
    return headers


def test_help_reaches_the_office_followers_and_the_emergency_contact(
    client, db, push, mailer, numbered, office, anna, friend
):
    r = client.patch("/profile", json={"emergency_email": "mum@example.com"}, headers=anna)
    assert r.status_code == 200, r.text
    assert client.post("/outings/current/help", json={}, headers=anna).status_code == 404
    go_out(client, anna)
    r = client.post("/outings/current/help", json={"location": FIX}, headers=anna)
    assert r.status_code == 201, r.text
    out = r.json()
    assert (out["office_told"], out["followers_told"], out["contact_told"]) == (2, 1, True)
    assert out["office"]["phone"].endswith("9876511111")
    for phone in (WARDEN_A, HEAD):
        [m] = sent_to(push, phone)
        assert m.urgent and m.title == "Help: Anna pressed Help"
    [m] = sent_to(push, FRIEND)
    assert m.urgent and m.title == "Anna pressed Help" and "30.3" not in m.body
    assert sent_to(push, WARDEN_B) == [] and sent_to(push, ADMIN) == []
    [mail] = [m for m in mailer.outbox if m.to == "mum@example.com"]
    assert "Anna asked for help" in mail.subject and "30.3" not in mail.body
    assert "9876511111" in mail.body.replace(" ", "").replace("-", "")
    saved = db.execute(text("SELECT lat, lng, accuracy_m, mocked FROM help_requests")).one()
    assert tuple(saved) == (30.31234, 78.03456, 12.0, False)


def test_the_office_email_has_the_fix_but_no_name(client, db, push, mailer, admin, hostels, anna):
    staff(client, admin, "head@geu.ac.in", "Head Warden", "head_warden")  # no app
    go_out(client, anna)
    client.post("/outings/current/help", json={"location": {**FIX, "mocked": True}}, headers=anna)
    [mail] = mail_to(mailer, "head@geu.ac.in")
    assert "https://www.openstreetmap.org/?mlat=30.31234&mlon=78.03456" in mail.body
    assert "mock-location app" in mail.body
    assert "Anna" not in mail.body and "Anna" not in mail.subject


def test_the_office_sees_and_handles_help_in_its_hostels_only(client, db, push, office, anna):
    go_out(client, anna)
    client.post("/outings/current/help", json={"location": FIX}, headers=anna)
    [h] = client.get("/admin/help", headers=office["A"]).json()
    assert (h["name"], h["hostel"], h["lat"], h["returned"]) == (
        "Anna",
        "Hostel A",
        30.31234,
        False,
    )
    assert client.get("/admin/overview", headers=office["A"]).json()["open_help"] == 1
    assert client.get("/admin/help", headers=office["B"]).json() == []
    assert client.get("/admin/overview", headers=office["B"]).json()["open_help"] == 0
    assert client.get("/admin/help", headers=anna).status_code == 403
    r = client.post(f"/admin/help/{h['id']}/handle", json={}, headers=office["B"])
    assert r.status_code == 404
    r = client.post(f"/admin/help/{h['id']}/handle", json={"note": "Called"}, headers=office["A"])
    assert r.status_code == 204
    assert client.get("/admin/help", headers=office["A"]).json() == []
    [h] = client.get("/admin/help", params={"state": "all"}, headers=office["A"]).json()
    assert (h["handled_by"], h["note"]) == ("Warden A", "Called")
    assert audit(db, "help:handle") == [(h["id"],)]


def test_help_is_rate_limited_and_works_without_a_location(client, db, push, office, anna):
    # Help is for a student who is out (and a refused ask doesn't use one up).
    assert client.post("/outings/current/help", json={}, headers=anna).status_code == 404
    go_out(client, anna)
    for _ in range(5):
        assert client.post("/outings/current/help", json={}, headers=anna).status_code == 201
    assert client.post("/outings/current/help", json={}, headers=anna).status_code == 429
    assert db.execute(text("SELECT count(*) FROM help_requests WHERE lat IS NULL")).scalar() == 5
    bad = {"location": {"lat": 91, "lng": 0, "accuracy_m": 5}}
    assert client.post("/outings/current/help", json=bad, headers=anna).status_code == 422


def test_the_fix_is_forgotten_after_a_day(client, db, push, office, anna):
    go_out(client, anna)
    client.post("/outings/current/help", json={"location": FIX}, headers=anna)
    db.execute(text("UPDATE help_requests SET created_at = now() - interval '25 hours'"))
    db.commit()
    run_sweep(client)
    assert db.execute(text("SELECT lat, lng, accuracy_m FROM help_requests")).one() == (
        None,
        None,
        None,
    )


# ---------- review and audit fixes (2026-11-08) ----------


class Log:
    """The order alerts went out in, pushes and emails together."""

    def __init__(self) -> None:
        self.sent: list[str] = []


class LoggedPush(Push):
    def __init__(self, log: Log) -> None:
        super().__init__()
        self.log = log

    async def send(self, tokens, message):
        self.log.sent.append(f"push {message.title}")
        return await super().send(tokens, message)


class LoggedMailer(Mailer):
    def __init__(self, log: Log) -> None:
        super().__init__()
        self.log = log

    async def send(self, email: Email) -> None:
        self.log.sent.append(f"email {email.subject}")
        await super().send(email)


class Hanging(Push):
    """A push service that doesn't answer for 5 s."""

    async def send(self, tokens, message):
        await asyncio.sleep(5)
        return await super().send(tokens, message)


PUSH_OR_EMAIL = OutboxMode.PUSH_OR_EMAIL


def queue(client, *alerts) -> list[int]:
    """Outbox rows added directly, each (key, kind, mode, user_id, urgent); the key is also the
    push title and the email subject, and every email is queued to queued@geu.ac.in."""

    async def add():
        async with client.app.state.sessionmaker() as session:
            ids = []
            for key, kind, mode, uid, urgent in alerts:
                found = await outbox.enqueue(
                    session,
                    key=key,
                    kind=kind,
                    mode=mode,
                    user_id=uid,
                    push=None
                    if mode is OutboxMode.EMAIL
                    else PushMessage(key, "Body", urgent=urgent),
                    email=None
                    if mode is OutboxMode.PUSH
                    else Email("queued@geu.ac.in", key, "Body"),
                )
                ids.append(found)
            await session.commit()
            return ids

    return client.portal.call(add)


def deliver(client, push, mailer, budget=outbox.BUDGET_SECONDS) -> outbox.Delivery:
    state = client.app.state
    return client.portal.call(outbox.deliver, state.sessionmaker, push, mailer, None, budget)


def by_key(db) -> dict:
    return {r.key: r for r in rows(db)}


def test_safety_alerts_go_first_and_fresh_ones_before_retries(client, db, admin, anna):
    log = Log()
    anna_id = user_id(client, admin, "anna@geu.ac.in")
    queue(
        client,
        ("retry-notice", "notice", PUSH_OR_EMAIL, anna_id, False),
        ("fresh-notice", "notice", PUSH_OR_EMAIL, anna_id, False),
        ("retry-recall", "recall", PUSH_OR_EMAIL, anna_id, True),
        ("contact", "help_contact", OutboxMode.EMAIL, None, False),
        ("recall", "recall", PUSH_OR_EMAIL, anna_id, True),
    )
    db.execute(text("UPDATE alert_outbox SET attempts = 2 WHERE key LIKE 'retry-%'"))
    db.commit()
    assert deliver(client, LoggedPush(log), LoggedMailer(log)).sent == 5
    assert log.sent == [
        "email contact",
        "push recall",
        "push retry-recall",
        "push fresh-notice",
        "push retry-notice",
    ]


def test_after_a_push_failure_a_pass_stops_trying_push(client, db, admin, office, anna):
    push, mailer = Push(), Mailer()
    push.down = True
    head_id = user_id(client, admin, "head@geu.ac.in")
    anna_id = user_id(client, admin, "anna@geu.ac.in")
    queue(
        client,
        ("esc-1", "escalation", OutboxMode.PUSH, head_id, True),
        ("esc-2", "escalation", OutboxMode.PUSH, head_id, True),
        ("notice", "notice", PUSH_OR_EMAIL, anna_id, False),
        ("late", "late_alert", PUSH_OR_EMAIL, anna_id, True),
        ("esc-mail", "escalation", OutboxMode.EMAIL, None, True),
    )
    deliver(client, push, mailer)
    assert [m.title for _, m in push.outbox] == ["esc-1"]  # one failure, then no more push
    # The urgent alert is emailed without trying push; the email-only one goes as usual.
    assert sorted(m.subject for m in mailer.outbox if m.idempotency_key) == ["esc-mail", "late"]
    found = by_key(db)
    assert found["esc-1"].attempts == 1 and found["esc-1"].sent_at is None
    assert (found["esc-2"].attempts, found["notice"].attempts) == (0, 0)  # untried: next pass
    assert found["late"].sent_at is not None and found["esc-mail"].sent_at is not None


def test_a_hanging_push_service_cannot_hold_a_pass_past_its_budget(client, db, admin, anna):
    anna_id = user_id(client, admin, "anna@geu.ac.in")
    queue(
        client,
        ("recall", "recall", PUSH_OR_EMAIL, anna_id, True),
        ("notice", "notice", PUSH_OR_EMAIL, anna_id, False),
    )
    mailer = Mailer()
    started = time.monotonic()
    deliver(client, Hanging(), mailer, budget=0.5)
    assert time.monotonic() - started < 3
    # The urgent one still went out, by email; the notice waits for the next pass.
    assert [m.subject for m in mail_to(mailer, "anna@geu.ac.in")] == ["recall"]
    assert by_key(db)["notice"].attempts == 0


def test_the_last_try_of_a_push_or_email_alert_is_emailed(client, db, admin, anna):
    push, mailer = Push(), Mailer()
    push.down = True
    anna_id = user_id(client, admin, "anna@geu.ac.in")
    queue(client, ("notice", "notice", PUSH_OR_EMAIL, anna_id, False))
    db.execute(text("UPDATE alert_outbox SET attempts = :n"), {"n": outbox.MAX_ATTEMPTS - 1})
    db.commit()
    assert deliver(client, push, mailer).sent == 1
    assert [m.subject for m in mail_to(mailer, "anna@geu.ac.in")] == ["notice"]
    [row] = rows(db)
    assert row.sent_at is not None and row.failed_at is None and row.payload == {}


def test_a_queued_alert_follows_an_email_change(client, db, push, mailer, admin, anna):
    anna_id = user_id(client, admin, "anna@geu.ac.in")
    queue(client, ("late", "late_alert", PUSH_OR_EMAIL, anna_id, True))
    r = client.patch(f"/admin/users/{anna_id}", json={"email": "anna.k@geu.ac.in"}, headers=admin)
    assert r.status_code == 200, r.text
    deliver(client, push, mailer)  # signed out everywhere, so no phone: emailed
    assert mail_to(mailer, "queued@geu.ac.in") == []
    assert [m.subject for m in mail_to(mailer, "anna.k@geu.ac.in")] == ["late"]


def test_queued_help_alerts_skip_staff_turned_off_and_followers_cut_off(
    client, db, push, mailer, admin, office, anna, friend
):
    go_out(client, anna)
    client.app.state.push = None  # queued, not sent yet
    r = client.post("/outings/current/help", json={"location": FIX}, headers=anna)
    assert r.status_code == 201, r.text
    warden = user_id(client, admin, "warden.a@geu.ac.in")
    r = client.post(f"/admin/users/{warden}/active", json={"on": False}, headers=admin)
    assert r.status_code == 200, r.text
    db.execute(text("UPDATE share_viewers SET status = 'revoked', revoked_at = now()"))
    db.commit()
    deliver(client, push, mailer)
    assert len(sent_to(push, HEAD)) == 1
    assert sent_to(push, FRIEND) == [] and mail_to(mailer, "friend@geu.ac.in") == []
    assert sent_to(push, WARDEN_A) == [] and mail_to(mailer, "warden.a@geu.ac.in") == []
    given_up = db.execute(
        text("SELECT kind, payload FROM alert_outbox WHERE failed_at IS NOT NULL ORDER BY kind")
    ).all()
    assert [(k, p) for k, p in given_up] == [("help_follower", {}), ("help_office", {})]


def test_a_claim_lapses_when_the_claimer_is_turned_off(
    client, db, push, admin, hostels, office, anna
):
    e_id = escalate(client, db, push, anna)
    other = staff(client, admin, "warden.a2@geu.ac.in", "Warden A2", "warden", [hostels["A"]])
    client.post(f"/admin/escalations/{e_id}/claim", headers=office["A"])
    # Turned off behind the API's back: the sweep and release still ignore the claim.
    db.execute(text("UPDATE users SET deactivated_at = now() WHERE email = 'warden.a@geu.ac.in'"))
    db.commit()
    opened_ago(db, 31)
    assert run_sweep(client).followed_up == 1
    [m] = sent_to(push, HEAD)
    assert m.title == "A late student needs you to take over"
    assert db.execute(text("SELECT claimed_by FROM escalations")).scalar_one() is None
    # A co-warden may take over such a claim, or give it back.
    lapsed = (
        "UPDATE escalations SET claimed_by = "
        "(SELECT id FROM users WHERE email = 'warden.a@geu.ac.in')"
    )
    db.execute(text(lapsed))
    db.commit()
    assert client.post(f"/admin/escalations/{e_id}/claim", headers=other).status_code == 204
    [e] = client.get("/admin/escalations", headers=other).json()
    assert e["claimed_by"] == "Warden A2"
    db.execute(text(lapsed))
    db.commit()
    assert client.delete(f"/admin/escalations/{e_id}/claim", headers=other).status_code == 204
    assert db.execute(text("SELECT claimed_by FROM escalations")).scalar_one() is None


def test_a_claim_lapses_when_the_claimer_no_longer_covers_the_hostel(
    client, db, push, admin, hostels, office, anna
):
    e_id = escalate(client, db, push, anna)
    client.post(f"/admin/escalations/{e_id}/claim", headers=office["A"])
    warden = user_id(client, admin, "warden.a@geu.ac.in")
    claimed = "SELECT claimed_by IS NOT NULL FROM escalations"
    # Given hostel B as well: still covers A, so the claim stays.
    body = {"role": "warden", "hostel_ids": [hostels["A"], hostels["B"]]}
    assert client.post(f"/admin/users/{warden}/role", json=body, headers=admin).status_code == 200
    assert db.execute(text(claimed)).scalar_one()
    body = {"role": "warden", "hostel_ids": [hostels["B"]]}
    assert client.post(f"/admin/users/{warden}/role", json=body, headers=admin).status_code == 200
    assert not db.execute(text(claimed)).scalar_one()
    # Their hostel deleted: the hostel's warden's claim goes.
    other = staff(client, admin, "warden.a2@geu.ac.in", "Warden A2", "warden", [hostels["A"]])
    assert client.post(f"/admin/escalations/{e_id}/claim", headers=other).status_code == 204
    assert client.delete(f"/admin/hostels/{hostels['A']}", headers=admin).status_code == 200
    assert not db.execute(text(claimed)).scalar_one()
    # Turned off: the claim goes too.
    client.post(f"/admin/escalations/{e_id}/claim", headers=office["head"])
    assert db.execute(text(claimed)).scalar_one()
    head = user_id(client, admin, "head@geu.ac.in")
    r = client.post(f"/admin/users/{head}/active", json={"on": False}, headers=admin)
    assert r.status_code == 200, r.text
    assert not db.execute(text(claimed)).scalar_one()


def test_re_alerts_stop_at_the_cap(client, db, push, office, anna):
    escalate(client, db, push, anna)
    db.execute(
        text("UPDATE escalations SET handed_over_at = now(), realerts = :n"),
        {"n": escalations.MAX_REALERTS - 1},
    )
    db.commit()
    opened_ago(db, 300, realerted=16)
    assert run_sweep(client).followed_up == 1  # the last one
    opened_ago(db, 320, realerted=16)
    assert run_sweep(client).followed_up == 0
    assert len(sent_to(push, HEAD)) == 1


def test_a_long_notice_keeps_the_count_and_hostel_in_the_audit(
    client, db, push, office, hostels, bina
):
    go_out(client, bina)
    r = client.post(
        "/admin/notices",
        json={"message": "x" * 200, "hostel_id": hostels["B"]},
        headers=office["head"],
    )
    assert r.json() == {"sent": 1}
    [(target,)] = audit(db, "notice:send")
    assert target == "1 out, Hostel B"


def test_help_contact_mail_is_capped_per_address_and_per_student(
    client, db, push, mailer, clock, office, anna
):
    def contact_told() -> bool:
        r = client.post("/outings/current/help", json={}, headers=anna)
        assert r.status_code == 201, r.text
        return r.json()["contact_told"]

    def contact(address):
        r = client.patch("/profile", json={"emergency_email": address}, headers=anna)
        assert r.status_code == 200, r.text

    go_out(client, anna)
    contact("mum@example.com")
    assert [contact_told() for _ in range(5)] == [True] * 5  # Help allows 5 an hour
    clock.advance(3601)
    assert contact_told() is False  # 5 a day to one inbox, plus-tags and case alike
    contact("Mum+help@Example.com")
    assert contact_told() is False
    contact("dad@example.com")
    assert [contact_told() for _ in range(3)] == [True] * 3
    clock.advance(3601)
    assert [contact_told() for _ in range(2)] == [True] * 2  # the student's 10th today
    contact("aunt@example.com")
    assert contact_told() is False  # 10 a day from one student
    assert len(mail_to(mailer, "mum@example.com")) == 5
    assert len(mail_to(mailer, "dad@example.com")) == 5
    # The office was told every time all the same.
    assert len(sent_to(push, WARDEN_A)) == 13


def test_the_outbox_key_never_holds_the_contact_address(client, db, push, mailer, office, anna):
    client.patch("/profile", json={"emergency_email": "mum@example.com"}, headers=anna)
    go_out(client, anna)
    client.post("/outings/current/help", json={}, headers=anna)
    [key] = db.execute(text("SELECT key FROM alert_outbox WHERE kind = 'help_contact'")).scalars()
    assert "@" not in key and "mum" not in key


def test_a_failed_send_logs_no_address_or_provider_answer(client, db, admin, anna, caplog):
    class Refusing(Mailer):
        async def send(self, email: Email) -> None:
            raise RuntimeError(f"Resend answered 422: {email.to} is not allowed")

    queue(client, ("contact", "help_contact", OutboxMode.EMAIL, None, False))
    deliver(client, Push(), Refusing())
    assert "queued@geu.ac.in" not in caplog.text and "Resend answered" not in caplog.text
    assert "RuntimeError" in caplog.text


def test_the_export_holds_help_requests_and_escalation_calls(client, db, push, office, anna):
    e_id = escalate(client, db, push, anna)
    client.post("/outings/current/help", json={"location": FIX}, headers=anna)
    client.post(
        f"/admin/escalations/{e_id}/calls",
        json={"outcome": "reached_contact", "note": "Office note"},
        headers=office["A"],
    )
    data = client.get("/profile/export", headers=anna).json()
    [h] = data["help_requests"]
    assert (h["hostel"], h["lat"], h["lng"]) == ("Hostel A", 30.31234, 78.03456)
    assert h["handled_at"] is None
    [outing] = data["outings"]
    assert [c["outcome"] for c in outing["escalation_calls"]] == ["reached_contact"]
    assert "Office note" not in json.dumps(data) and "Warden A" not in json.dumps(data)


def test_staff_cannot_set_a_hostel_of_their_own(client, db, office, hostels):
    r = client.patch("/profile", json={"hostel_id": hostels["B"]}, headers=office["A"])
    assert r.status_code == 200 and r.json()["hostel_id"] is None


def test_an_open_help_request_blocks_deleting_the_account_and_deleting_cancels_its_alerts(
    client, db, push, mailer, office, anna
):
    client.patch("/profile", json={"emergency_email": "mum@example.com"}, headers=anna)
    go_out(client, anna)
    client.app.state.push = None  # queued, not sent yet
    client.post("/outings/current/help", json={"location": FIX}, headers=anna)
    assert client.post("/outings/current/return", headers=anna).status_code == 200
    r = client.post("/auth/delete-account", json={"password": PASSWORD}, headers=anna)
    assert r.status_code == 409 and r.json()["detail"] == accounts.HELP_OPEN
    [h] = client.get("/admin/help", headers=office["A"]).json()
    client.post(f"/admin/help/{h['id']}/handle", json={}, headers=office["A"])
    r = client.post("/auth/delete-account", json={"password": PASSWORD}, headers=anna)
    assert r.status_code == 204, r.text
    deliver(client, push, mailer)
    assert push.outbox == [] and mail_to(mailer, "mum@example.com") == []
    assert all(r.payload == {} and r.sent_at is None for r in rows(db))
