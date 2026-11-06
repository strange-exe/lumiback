"""Safe return: a student's emergency contact follows one outing by email link until return.

The tick at check-out is the consent (no second approval); the link works only while the
outing's share is live; the contact gets at most a start, an overdue and a "back" email."""

import asyncio
import base64
import hmac
import re
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

import anyio
import pytest
from sqlalchemy import text

from app.jobs.expiry import sweep
from app.models import SessionStatus
from app.push import MemoryPushSender
from app.security.rate_limit import RateLimiter
from app.services import outings as outings_svc
from app.services import safe_return
from app.services import sessions as sessions_svc
from app.services.safe_return import PER_CONTACT, PER_STUDENT, watch_token
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


async def reserve(limiter: RateLimiter, student_id: uuid.UUID, email: str) -> bool:
    """One safe-return start against both limits, as a check-out makes it."""
    return await safe_return.reserve(limiter, student_id, email) is not None


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


@pytest.mark.parametrize(
    ("name", "label"),
    [
        ("Sunita", "Sunita (emergency contact)"),
        ("", "Emergency contact"),
        # A long name is cut, never the suffix: a cut-off label is one a guest could copy.
        ("Sunita Ramakrishnan Venkataraman", "Sunita Ramakrishnan (emergency contact)"),
    ],
)
def test_the_contact_label_always_ends_in_the_whole_suffix(name, label):
    student = SimpleNamespace(emergency_name=name)
    assert safe_return.guest_label(student) == label
    assert len(label) <= 40


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
    # Inbox-tested as HTML (2026-11-06): the link is a button, with the same words as the text.
    assert email.html and 'border-radius:10px;"><a href="' in email.html
    assert "Follow their way back" in email.html
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
    assert [(v["name"], v["kind"], v["status"], v["contact"]) for v in mine["viewers"]] == [
        ("Sunita Sharma (emergency contact)", "guest", "granted", True)
    ]
    log = client.get(f"/sessions/{session_id}/access-log", headers=riya).json()
    assert [(e["viewer_name"], e["kind"], e["contact"]) for e in log] == [
        ("Sunita Sharma (emergency contact)", "guest", True)
    ]
    # Only its hash is stored.
    assert token.encode() not in b"".join(
        db.execute(text("SELECT guest_token_hash FROM share_viewers")).scalars()
    )


def test_only_the_real_contact_is_marked_as_the_contact(client, riya):
    """A code guest can borrow letters from another script to copy the contact's label; the
    server's own mark, not the label, is what tells the student which one is real."""
    session_id = go_out(client, riya, safe_return=True)["safe_return_session_id"]
    code = client.post(f"/sessions/{session_id}/codes", headers=riya).json()["code"]
    look_alike = "Sunita Sharma (" + chr(0x0435) + "mergency contact)"  # Cyrillic ie
    r = client.post("/codes/redeem", json={"code": code, "guest_label": look_alike})
    assert r.status_code == 200, r.text

    viewers = client.get(f"/sessions/{session_id}", headers=riya).json()["viewers"]
    assert [(v["name"], v["status"], v["contact"]) for v in viewers] == [
        ("Sunita Sharma (emergency contact)", "granted", True),
        (look_alike, "pending", False),
    ]
    # The student's data export keeps the same mark.
    (share,) = client.get("/profile/export", headers=riya).json()["share_sessions"]
    assert [(v["name"], v["contact"]) for v in share["viewers"]] == [
        ("Sunita Sharma (emergency contact)", True),
        (look_alike, False),
    ]


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
    assert link_in(overdue[0]) == (session_id, token)  # the same link
    assert "+919876543210" in overdue[0].body  # her number, to call
    html = overdue[0].html or ""  # formatted, inbox-tested 2026-11-06
    assert 'href="tel:+919876543210"' in html and f"/watch/{session_id}#" in html
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
        assert client.portal.call(reserve, client.app.state.limiter, uuid.uuid4(), CONTACT)
    assert go_out(client, riya, safe_return=True)["safe_return_session_id"] is None
    assert to_contact(client) == []


def test_plus_aliases_and_case_count_as_the_same_contact_address(client, riya):
    """sunita.sharma+1@gmail.com reaches the same inbox, so it shares the address's limit."""
    for i in range(PER_CONTACT.max_hits):
        alias = f"Sunita.Sharma+{i}@GMAIL.com"
        assert client.portal.call(reserve, client.app.state.limiter, uuid.uuid4(), alias)
    assert go_out(client, riya, safe_return=True)["safe_return_session_id"] is None
    assert to_contact(client) == []


def test_parallel_check_outs_cant_pass_the_contact_limit(client):
    """The check and the count happen under one lock, so a burst can't all see "under"."""
    limiter = client.app.state.limiter

    async def burst() -> list[bool]:
        tries = (reserve(limiter, uuid.uuid4(), CONTACT) for _ in range(PER_CONTACT.max_hits + 4))
        return await asyncio.gather(*tries)

    assert client.portal.call(burst).count(True) == PER_CONTACT.max_hits


def test_failed_check_outs_dont_use_up_the_contacts_limit(client, db, riya, gate):
    """Only starts that happen count: another student who names riya's contact as their own
    can't burn the address's daily limit with scans and check-outs that fail."""
    mallory = signup(client, "mallory@geu.ac.in", "Mallory")[1]
    r = client.patch(
        "/profile", json={"contacts": CONTACTS, "emergency_email": CONTACT}, headers=mallory
    )
    assert r.status_code == 200, r.text
    for _ in range(PER_CONTACT.max_hits):  # an invalid QR is refused
        bogus = client.post(
            "/gates/scan", json={"qr": "bogus", **AT_GATE, "safe_return": True}, headers=mallory
        )
        assert bogus.status_code == 422, bogus.text
    assert go_out(client, mallory)["safe_return_session_id"] is None  # out without it
    for _ in range(2):  # already out
        again = client.post(
            "/outings", json={"destination": "Rajpur Road", "safe_return": True}, headers=mallory
        )
        assert again.status_code == 409, again.text
    age_scans(db)
    back = scan(client, mallory, gate, safe_return=True)  # a tap-in starts nothing
    assert back.json()["direction"] == "in", back.text
    assert to_contact(client) == []

    assert go_out(client, riya, safe_return=True)["safe_return_session_id"] is not None
    assert len(to_contact(client)) == 1


@pytest.mark.parametrize("field", ["destination", "purpose"])
def test_check_out_text_refuses_control_characters(client, riya, field):
    """A NUL can't be stored (the insert fails after the slot is counted), and line breaks
    or bidi overrides would show on wardens' screens: refused before anything is counted."""
    for bad in ("Rajpur" + chr(0) + "Road", "Rajpur" + chr(10) + "Road", "Rajpur" + chr(0x202E)):
        body = {"destination": "Rajpur Road", field: bad, "safe_return": True}
        r = client.post("/outings", json=body, headers=riya)
        assert r.status_code == 422, r.text
    if field == "destination":
        r = client.post(
            "/gates/scan",
            json={"qr": "bogus", **AT_GATE, "destination": "a" + chr(0), "safe_return": True},
            headers=riya,
        )
        assert r.status_code == 422 and "destination" in r.text, r.text


def test_a_cancelled_request_still_gives_the_slot_back(client):
    """An aborted request (cancellation) must not skip the refund: release runs shielded."""
    limiter = client.app.state.limiter

    async def reserve_then_cancel() -> None:
        reservation = await safe_return.reserve(limiter, uuid.uuid4(), CONTACT)
        assert reservation is not None
        with anyio.CancelScope() as scope:
            scope.cancel()  # every unshielded await in here is cancelled
            await safe_return.release(limiter, reservation)

    for _ in range(PER_CONTACT.max_hits + 1):
        client.portal.call(reserve_then_cancel)
    assert client.portal.call(reserve, limiter, uuid.uuid4(), CONTACT)


def test_an_unexpected_check_out_error_gives_the_slot_back(client, riya, monkeypatch):
    """Any failure that starts no share refunds it, not only the ones the API names: else
    another student could burn the contact's limit with a request that errors on purpose."""
    real = outings_svc.check_out

    async def broken(*args, **kwargs):
        raise RuntimeError("database went away")

    monkeypatch.setattr(outings_svc, "check_out", broken)
    for _ in range(PER_CONTACT.max_hits + 1):
        with pytest.raises(RuntimeError):
            client.post(
                "/outings", json={"destination": "Rajpur Road", "safe_return": True}, headers=riya
            )
    monkeypatch.setattr(outings_svc, "check_out", real)
    assert go_out(client, riya, safe_return=True)["safe_return_session_id"] is not None


def test_a_student_over_their_limit_uses_none_of_the_contacts(client):
    limiter = client.app.state.limiter
    student = uuid.uuid4()
    for i in range(PER_STUDENT.max_hits):
        assert client.portal.call(reserve, limiter, student, f"friend{i}@gmail.com")
    assert not client.portal.call(reserve, limiter, student, CONTACT)
    for _ in range(PER_CONTACT.max_hits):  # the refused try took nothing from the address
        assert client.portal.call(reserve, limiter, uuid.uuid4(), CONTACT)


# ---------- locking: return vs stopping the share ----------


async def wait_for_a_lock_wait(sessionmaker, timeout: float = 5.0) -> None:
    """Until another connection to this database is waiting on a row lock."""
    query = text(
        "SELECT count(*) FROM pg_stat_activity "
        "WHERE datname = current_database() AND wait_event_type = 'Lock'"
    )
    async with sessionmaker() as watcher:
        for _ in range(int(timeout / 0.02)):
            if await watcher.scalar(query):
                return
            await watcher.rollback()  # a fresh snapshot of pg_stat_activity each time
            await asyncio.sleep(0.02)
    raise AssertionError("the return never waited on the share's lock")


def test_returning_while_the_share_is_being_stopped_doesnt_deadlock(client, db, riya):
    """Stopping a share (and the sweep's expiry) locks the share, then the outing: a return
    must take them in the same order, or the two deadlock and one of them fails."""
    shared = uuid.UUID(go_out(client, riya, safe_return=True)["safe_return_session_id"])
    student_id = db.execute(
        text("SELECT id FROM users WHERE email = 'riya@geu.ac.in'")
    ).scalar_one()
    state = client.app.state
    pepper = state.settings.code_pepper.get_secret_value()

    async def race() -> tuple[object, bool]:
        async with state.sessionmaker() as stopping, state.sessionmaker() as returning:
            # The stop has locked the share (its first statement) when the return starts.
            await stopping.execute(
                text("SELECT id FROM share_sessions WHERE id = :id FOR UPDATE"), {"id": shared}
            )
            back = asyncio.create_task(
                outings_svc.mark_return(returning, student_id, pepper=pepper)
            )
            await wait_for_a_lock_wait(state.sessionmaker)
            stopped = await sessions_svc.end(
                stopping, shared, status=SessionStatus.ENDED, reason="stopped"
            )
            return await back, stopped

    returned, stopped = client.portal.call(race)
    assert returned is not None and stopped
    assert returned.outing.returned_at is not None
    row = db.execute(
        text("SELECT safe_return_email, returned_at FROM outings WHERE student_id = :s"),
        {"s": student_id},
    ).one()
    assert row.safe_return_email is None and row.returned_at is not None


# ---------- the student cuts the contact off ----------


def contact_viewer(client, headers, session_id: str) -> dict:
    [viewer] = client.get(f"/sessions/{session_id}", headers=headers).json()["viewers"]
    return viewer


def test_revoking_the_contact_stops_the_overdue_and_back_emails(client, db, riya):
    go_out(client, riya, safe_return=True)
    session_id, token = link_in(to_contact(client)[0])
    viewer = contact_viewer(client, riya, session_id)
    r = client.post(f"/sessions/{session_id}/viewers/{viewer['id']}/revoke", headers=riya)
    assert r.status_code == 200, r.text
    assert watch(client, session_id, token).status_code == 403
    # The address is no longer needed once the contact can't follow.
    assert db.execute(text("SELECT safe_return_email FROM outings")).scalar_one() is None

    late_by(db, 31)
    assert run_sweep(client).overdue_notified == 1  # the student's own alert still goes
    assert client.post("/outings/current/return", headers=riya).status_code == 200
    assert len(to_contact(client)) == 1  # only the start email: no overdue, no "back"


def test_a_revoked_contact_viewer_gets_no_emails_however_it_was_revoked(client, db, riya):
    """The emails check the contact's own viewer row, not only the stored address."""
    go_out(client, riya, safe_return=True)
    db.execute(text("UPDATE share_viewers SET status = 'revoked', revoked_at = now()"))
    db.commit()

    late_by(db, 31)
    assert run_sweep(client).overdue_notified == 1
    client.post("/outings/current/return", headers=riya)
    assert len(to_contact(client)) == 1


def test_stopping_the_share_forgets_the_contacts_address(client, db, riya):
    session_id = go_out(client, riya, safe_return=True)["safe_return_session_id"]
    assert client.post(f"/sessions/{session_id}/stop", headers=riya).status_code == 200
    assert db.execute(text("SELECT safe_return_email FROM outings")).scalar_one() is None


def test_an_expired_share_forgets_the_contacts_address(client, db, riya):
    session_id = go_out(client, riya, safe_return=True)["safe_return_session_id"]
    db.execute(
        text(
            "UPDATE share_sessions SET created_at = now() - interval '2 days', "
            "ends_at = now() - interval '1 minute'"
        )
    )
    db.commit()
    assert run_sweep(client).expired_sessions == [uuid.UUID(session_id)]
    assert db.execute(text("SELECT safe_return_email FROM outings")).scalar_one() is None
    client.post("/outings/current/return", headers=riya)
    assert len(to_contact(client)) == 1  # no "back" after the link had ended


NEW_CONTACT = "papa.verma@gmail.com"


@pytest.mark.parametrize("new_email", [NEW_CONTACT, None])
def test_changing_the_emergency_email_while_out_cuts_the_old_contact_off(
    client, db, riya, new_email
):
    go_out(client, riya, safe_return=True)
    session_id, token = link_in(to_contact(client)[0])

    r = client.patch("/profile", json={"emergency_email": new_email}, headers=riya)
    assert r.status_code == 200, r.text
    assert watch(client, session_id, token).status_code == 403
    assert contact_viewer(client, riya, session_id)["status"] == "revoked"
    assert db.execute(text("SELECT safe_return_email FROM outings")).scalar_one() is None

    late_by(db, 31)
    assert run_sweep(client).overdue_notified == 1
    client.post("/outings/current/return", headers=riya)
    assert len(to_contact(client)) == 1
    # The new address never chose to follow this outing either.
    assert [m for m in client.app.state.mailer.outbox if m.to == NEW_CONTACT] == []


@pytest.mark.parametrize(
    "body",
    [{"contacts": CONTACTS}, {"emergency_email": "Sunita.Sharma@Gmail.com"}],
    ids=["contacts only", "same address"],
)
def test_saving_the_profile_without_a_new_address_keeps_the_contact(client, db, riya, body):
    go_out(client, riya, safe_return=True)
    session_id, token = link_in(to_contact(client)[0])
    assert client.patch("/profile", json=body, headers=riya).status_code == 200
    assert watch(client, session_id, token).status_code == 200
    assert db.execute(text("SELECT safe_return_email FROM outings")).scalar_one() == CONTACT


def test_emails_greet_nobody_by_name_when_the_profile_names_someone_else(client, db, riya):
    """The greeting comes from today's profile, the address from check-out: if the profile's
    address is no longer the one being emailed, its name is not this person's."""
    go_out(client, riya, safe_return=True)
    db.execute(text("UPDATE users SET emergency_email = :e"), {"e": NEW_CONTACT})
    db.commit()

    late_by(db, 31)
    run_sweep(client)
    client.post("/outings/current/return", headers=riya)
    _, overdue, back = to_contact(client)
    for email in (overdue, back):
        assert email.body.startswith("Hi there,"), email.body
        assert "Sunita" not in email.body
    assert "+919876543210" in overdue.body  # the student's phone stays


def test_emails_greet_the_contact_by_name_while_the_address_matches(client, db, riya):
    go_out(client, riya, safe_return=True)
    late_by(db, 31)
    run_sweep(client)
    client.post("/outings/current/return", headers=riya)
    assert [m.body.split("\n")[0] for m in to_contact(client)] == ["Hi Sunita,"] * 3


# ---------- the watch token ----------


def test_the_watch_token_has_its_own_key_derived_from_the_pepper(client, riya):
    pepper = client.app.state.settings.code_pepper.get_secret_value()
    session_id = uuid.uuid4()

    def b64(digest: bytes) -> str:
        return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()

    old = b64(hmac.digest(pepper.encode(), f"safe-return:{session_id}".encode(), "sha256"))
    subkey = hmac.digest(pepper.encode(), b"lumiback/watch-token/v1", "sha256")
    assert watch_token(session_id, pepper) != old
    assert watch_token(session_id, pepper) == b64(
        hmac.digest(subkey, str(session_id).encode(), "sha256")
    )

    # And the link built from it still opens the share.
    shared = go_out(client, riya, safe_return=True)["safe_return_session_id"]
    session, token = link_in(to_contact(client)[0])
    assert token == watch_token(uuid.UUID(shared), pepper)
    assert watch(client, session, token).status_code == 200


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
