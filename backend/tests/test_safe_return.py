"""Safe return: a student's emergency contact follows one outing by email link until return.

The tick at check-out is the consent (no second approval); the link works only while the
outing's share is live; the contact gets at most a start, an overdue and a "back" email."""

import re
import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import text

from app.jobs.expiry import sweep
from app.push import MemoryPushSender
from app.services.safe_return import PER_CONTACT, PER_STUDENT, record
from tests.helpers import create_gate, kiosk_qr, make_admin, signup
from tests.test_escalations import late_by
from tests.test_gates import AT_GATE, age_scans

CONTACT = "sunita.sharma@gmail.com"
CONTACTS = {
    "phone": "9876543210",
    "emergency_name": "Sunita Sharma",
    "emergency_relation": "Mother",
    "emergency_phone": "9123456789",
}
LINK = re.compile(r"https://lumiback\.test/watch/([0-9a-f-]{36})#key=([A-Za-z0-9_-]+)")


@pytest.fixture(autouse=True)
def web_url(client):
    client.app.state.settings.web_url = "https://lumiback.test"


@pytest.fixture
def riya(client):
    headers = signup(client, "riya@geu.ac.in", "Riya Verma")[1]
    r = client.patch(
        "/profile",
        json={"contacts": CONTACTS, "emergency_email": "Sunita.Sharma@Gmail.com"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return headers


def to_contact(client) -> list:
    return [m for m in client.app.state.mailer.outbox if m.to == CONTACT]


def go_out(client, headers, **body) -> dict:
    r = client.post("/outings", json={"destination": "Rajpur Road", **body}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def watch(client, session_id: str, token: str):
    return client.get(f"/sessions/{session_id}/location", headers={"X-Guest-Token": token})


def link_in(email) -> tuple[str, str]:
    match = LINK.search(email.body)
    assert match, email.body
    return match.group(1), match.group(2)


def run_sweep(client):
    state = client.app.state
    return client.portal.call(
        sweep,
        state.sessionmaker,
        state.hub,
        MemoryPushSender(),
        state.mailer,
        "https://lumiback.test",
        state.settings.code_pepper.get_secret_value(),
    )


# ---------- the contact's email address ----------


def test_profile_keeps_the_emergency_email_lowercase(client, riya):
    assert client.get("/profile", headers=riya).json()["emergency_email"] == CONTACT


def test_saving_contacts_without_the_email_keeps_it(client, riya):
    """Older app versions send only `contacts`: they must never clear the address."""
    r = client.patch("/profile", json={"contacts": CONTACTS}, headers=riya)
    assert r.json()["emergency_email"] == CONTACT


def test_the_emergency_email_can_be_cleared(client, riya):
    r = client.patch("/profile", json={"emergency_email": None}, headers=riya)
    assert r.json()["emergency_email"] is None


@pytest.mark.parametrize("bad", ["not-an-email", "a@b", "x" * 250 + "@gmail.com", ""])
def test_a_bad_emergency_email_is_refused(client, riya, bad):
    r = client.patch("/profile", json={"emergency_email": bad}, headers=riya)
    assert r.status_code == 422
    assert client.get("/profile", headers=riya).json()["emergency_email"] == CONTACT


# ---------- check-out ----------


def test_unticked_sends_nothing_and_shares_nothing(client, db, riya):
    outing = go_out(client, riya)
    assert outing["safe_return_session_id"] is None
    assert to_contact(client) == []
    assert db.execute(text("SELECT count(*) FROM share_sessions")).scalar_one() == 0


def test_ticked_without_an_emergency_email_still_checks_out(client, db, riya):
    client.patch("/profile", json={"emergency_email": None}, headers=riya)
    outing = go_out(client, riya, safe_return=True)
    assert outing["safe_return_session_id"] is None
    assert db.execute(text("SELECT count(*) FROM share_sessions")).scalar_one() == 0


def test_ticked_emails_the_contact_one_working_link(client, db, riya):
    outing = go_out(client, riya, safe_return=True)
    [email] = to_contact(client)
    assert email.html is None  # plain text only
    assert "Riya Verma" in email.subject
    assert email.body.startswith("Hi Sunita,")
    assert "chose to let you follow" in email.body  # why they got it, and that she chose it
    session_id, token = link_in(email)
    assert session_id == outing["safe_return_session_id"]

    # No account and no approval needed: the tick was the consent.
    seen = client.get(f"/sessions/{session_id}", headers={"X-Guest-Token": token})
    assert seen.status_code == 200, seen.text
    assert seen.json()["source"] == "outing" and seen.json()["sharer"]["name"] == "Riya Verma"
    assert watch(client, session_id, token).status_code == 200

    # The student sees the contact as a viewer, and every look in the access log.
    mine = client.get(f"/sessions/{session_id}", headers=riya).json()
    assert mine["ends_when"] == "until_return"
    assert [(v["name"], v["kind"], v["status"]) for v in mine["viewers"]] == [
        ("Sunita Sharma (emergency contact)", "guest", "granted")
    ]
    log = client.get(f"/sessions/{session_id}/access-log", headers=riya).json()
    assert [(e["viewer_name"], e["kind"]) for e in log] == [
        ("Sunita Sharma (emergency contact)", "guest")
    ]
    # Only its hash is stored.
    assert token.encode() not in b"".join(
        db.execute(text("SELECT guest_token_hash FROM share_viewers")).scalars()
    )


def test_the_link_opens_only_its_own_outing(client, riya):
    first = go_out(client, riya, safe_return=True)
    client.post("/outings/current/return", headers=riya)
    second = go_out(client, riya, safe_return=True)
    old_link = link_in(to_contact(client)[0])
    new_session = second["safe_return_session_id"]
    assert old_link[0] == first["safe_return_session_id"] != new_session
    assert watch(client, new_session, old_link[1]).status_code == 404


def test_the_location_the_contact_sees_is_the_one_the_student_sends(client, riya):
    session_id = go_out(client, riya, safe_return=True)["safe_return_session_id"]
    token = link_in(to_contact(client)[0])[1]
    assert watch(client, session_id, token).json()["location"] is None  # nothing sent yet
    r = client.put(
        f"/sessions/{session_id}/location",
        json={
            "lat": 30.3,
            "lng": 78.0,
            "accuracy_m": 12,
            "recorded_at": datetime.now(UTC).isoformat(),
        },
        headers=riya,
    )
    assert r.status_code == 204, r.text
    assert watch(client, session_id, token).json()["location"]["lat"] == 30.3


# ---------- return ----------


def test_return_ends_the_link_and_says_back_once(client, db, riya):
    go_out(client, riya, safe_return=True)
    session_id, token = link_in(to_contact(client)[0])

    assert client.post("/outings/current/return", headers=riya).status_code == 200
    assert watch(client, session_id, token).status_code == 403
    back = to_contact(client)[1:]
    assert [m.subject for m in back] == ["Lumiback: Riya Verma is back"]
    assert back[0].html is None
    mine = client.get(f"/sessions/{session_id}", headers=riya).json()
    assert (mine["status"], mine["ended_reason"]) == ("ended", "returned")
    # The contact's address is forgotten once the outing is over.
    assert db.execute(text("SELECT safe_return_email FROM outings")).scalar_one() is None

    assert client.post("/outings/current/return", headers=riya).status_code == 404
    assert len(to_contact(client)) == 2


def test_stopping_the_share_ends_the_link_and_the_emails(client, db, riya):
    go_out(client, riya, safe_return=True)
    session_id, token = link_in(to_contact(client)[0])
    assert client.post(f"/sessions/{session_id}/stop", headers=riya).status_code == 200
    assert watch(client, session_id, token).status_code == 403

    late_by(db, 31)
    assert run_sweep(client).overdue_notified == 1  # the student's own alert still goes
    client.post("/outings/current/return", headers=riya)
    assert len(to_contact(client)) == 1  # no overdue, no "back"


# ---------- overdue ----------


def test_overdue_emails_the_contact_once_with_the_link(client, db, riya):
    go_out(client, riya, safe_return=True)
    session_id, token = link_in(to_contact(client)[0])

    late_by(db, 20)
    run_sweep(client)
    assert len(to_contact(client)) == 1  # not yet: the student's alert is at 30 min

    late_by(db, 31)
    assert run_sweep(client).overdue_notified == 1
    overdue = to_contact(client)[1:]
    assert len(overdue) == 1 and "30 minutes past" in overdue[0].subject
    assert overdue[0].html is None
    assert link_in(overdue[0]) == (session_id, token)  # the same link
    assert "+919876543210" in overdue[0].body  # her number, to call
    assert watch(client, session_id, token).status_code == 200  # still works while late

    late_by(db, 90)
    run_sweep(client)
    assert len(to_contact(client)) == 2  # never twice


def test_overdue_without_safe_return_emails_no_contact(client, db, riya):
    go_out(client, riya)
    late_by(db, 31)
    assert run_sweep(client).overdue_notified == 1
    assert to_contact(client) == []


# ---------- limits ----------


def test_safe_return_emails_are_limited_per_day(client, riya):
    for _ in range(PER_STUDENT.max_hits):
        assert go_out(client, riya, safe_return=True)["safe_return_session_id"] is not None
        client.post("/outings/current/return", headers=riya)
    sent = len(to_contact(client))

    outing = go_out(client, riya, safe_return=True)  # still goes out
    assert outing["safe_return_session_id"] is None
    assert len(to_contact(client)) == sent


def test_one_contact_address_is_limited_across_students(client, riya):
    """Other accounts can't be used to keep mailing the same address."""
    for _ in range(PER_CONTACT.max_hits):  # other students' safe returns to the same address
        client.portal.call(record, client.app.state.limiter, uuid.uuid4(), CONTACT)
    assert go_out(client, riya, safe_return=True)["safe_return_session_id"] is None
    assert to_contact(client) == []


# ---------- at the gate ----------


@pytest.fixture
def gate(client, db):
    headers = signup(client, "warden@geu.ac.in", "Warden")[1]
    make_admin(db, "warden@geu.ac.in")
    return create_gate(client, headers)


def scan(client, headers, gate, **extra):
    qr = kiosk_qr(client, gate["kiosk_token"])
    return client.post("/gates/scan", json={"qr": qr, **AT_GATE, **extra}, headers=headers)


def test_gate_tap_out_and_in_with_safe_return(client, db, riya, gate):
    out = scan(client, riya, gate, safe_return=True)
    assert out.status_code == 200, out.text
    assert out.json()["direction"] == "out"
    session_id, token = link_in(to_contact(client)[0])
    assert out.json()["outing"]["safe_return_session_id"] == session_id
    assert watch(client, session_id, token).status_code == 200

    age_scans(db)
    back = scan(client, riya, gate, safe_return=True)  # ignored on the way in
    assert back.json()["direction"] == "in"
    assert watch(client, session_id, token).status_code == 403
    assert [m.subject for m in to_contact(client)][1:] == ["Lumiback: Riya Verma is back"]
    assert db.execute(text("SELECT count(*) FROM share_sessions")).scalar_one() == 1


def test_gate_tap_out_unticked_sends_nothing(client, riya, gate):
    out = scan(client, riya, gate)
    assert out.json()["outing"]["safe_return_session_id"] is None
    assert to_contact(client) == []
