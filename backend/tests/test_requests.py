"""Weekend/holiday outing requests: sent on the day, approved by an admin, used once to tap out.
Also the student's profile (hostel, contacts) and how a hostel picks the rules."""

from datetime import UTC, datetime, time, timedelta

import pytest
from sqlalchemy import text

from tests.helpers import make_admin, set_rules, signup

FORM = {
    "purpose": "Shopping at Pacific Mall",
    "phone": "98765 43210",
    "emergency_name": "Sunita Sharma",
    "emergency_relation": "Mother",
    "emergency_phone": "+91-91234-56789",
}


@pytest.fixture
def riya(client):
    return signup(client, "riya@geu.ac.in", "Riya")[1]


@pytest.fixture
def warden(client, db):
    _, headers = signup(client, "warden@geu.ac.in", "Warden")
    make_admin(db, "warden@geu.ac.in")
    return headers


@pytest.fixture
def form_day(db):
    return set_rules(db, "open", max_minutes=180, needs_form=True)


def send(client, headers, **changes):
    return client.post("/outings/request", json={**FORM, **changes}, headers=headers)


def decide(client, headers, request_id, approve=True, note=None):
    return client.post(
        f"/admin/requests/{request_id}/decision",
        json={"approve": approve, "note": note},
        headers=headers,
    )


def test_request_approve_then_tap_out_once(client, db, riya, warden, form_day):
    assert client.get("/outings/request", headers=riya).json() is None
    r = send(client, riya, requested_minutes=60)
    assert r.status_code == 201, r.text
    request = r.json()
    assert request["status"] == "pending" and request["used"] is False

    # Not yet approved: the gate (or the app) still says no.
    assert client.post("/outings", json={}, headers=riya).status_code == 403

    queue = client.get("/admin/requests", headers=warden).json()
    assert [(q["name"], q["status"], q["phone"]) for q in queue] == [
        ("Riya", "pending", "+919876543210")  # stored dialable
    ]
    assert queue[0]["emergency_phone"] == "+919123456789"
    assert queue[0]["max_minutes"] == 180

    approved = decide(client, warden, request["id"])
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved" and approved.json()["decided_by"] == "Warden"

    out = client.post("/outings", json={}, headers=riya)
    assert out.status_code == 201, out.text
    assert out.json()["purpose"] == FORM["purpose"]  # from the form
    assert client.get("/outings/request", headers=riya).json()["used"] is True

    # One approval, one outing.
    client.post("/outings/current/return", headers=riya)
    assert client.post("/outings", json={}, headers=riya).status_code == 403


def test_shorter_duration_on_request(client, db, riya, warden, form_day):
    request = send(client, riya, requested_minutes=60).json()
    decide(client, warden, request["id"])
    out = client.post("/outings", json={}, headers=riya).json()
    left = datetime.fromisoformat(out["left_at"])
    expected = datetime.fromisoformat(out["expected_return_at"])
    # 1 h of the 3 h allowed, but never past the day's return time.
    return_by = datetime.combine(
        left.date(), time.fromisoformat(form_day["return_by"]), left.tzinfo
    )
    assert abs(expected - min(left + timedelta(minutes=60), return_by)) < timedelta(seconds=5)


def test_never_longer_than_the_day_allows(client, riya, form_day):
    r = send(client, riya, requested_minutes=300)
    assert r.status_code == 403
    assert "at most 3 h" in r.json()["detail"]


def test_declined_request_with_a_note(client, riya, warden, form_day):
    request = send(client, riya).json()
    r = decide(client, warden, request["id"], approve=False, note="Exams tomorrow")
    assert r.json()["status"] == "declined"
    mine = client.get("/outings/request", headers=riya).json()
    assert (mine["status"], mine["note"]) == ("declined", "Exams tomorrow")
    assert client.post("/outings", json={}, headers=riya).status_code == 403
    assert send(client, riya).status_code == 201  # may ask again after a decline


def test_one_live_request_per_day_and_cancelling(client, riya, form_day):
    first = send(client, riya).json()
    assert send(client, riya).status_code == 409
    assert client.delete(f"/outings/request/{first['id']}", headers=riya).status_code == 204
    assert send(client, riya).status_code == 201


def test_asking_and_cancelling_cant_loop(client, riya, form_day, clock):
    """Each request pushes the hostel office (audit run-8): 10 an hour, then a pause."""
    for _ in range(10):
        r = send(client, riya)
        assert r.status_code == 201, r.text
        assert client.delete(f"/outings/request/{r.json()['id']}", headers=riya).status_code == 204
    assert send(client, riya).status_code == 429
    clock.advance(3601)
    assert send(client, riya).status_code == 201


def test_decided_requests_cant_be_decided_again(client, riya, warden, form_day):
    request = send(client, riya).json()
    assert decide(client, warden, request["id"]).status_code == 200
    assert decide(client, warden, request["id"], approve=False).status_code == 409


def test_the_decision_is_emailed_to_a_student_without_the_app(client, db, riya, warden, form_day):
    mailer = client.app.state.mailer
    request = send(client, riya).json()
    before = len(mailer.outbox)
    assert decide(client, warden, request["id"], approve=False, note="Exams tomorrow").status_code
    [mail] = [m for m in mailer.outbox[before:] if m.to == "riya@geu.ac.in"]
    assert mail.subject == "Lumiback: your outing request was declined"
    assert "The hostel office's note: Exams tomorrow" in mail.body
    assert "/home" in mail.body


def test_weekday_rules_need_no_request(client, db, riya):
    set_rules(db, "open")
    r = send(client, riya)
    assert r.status_code == 403
    assert "don't need a request" in r.json()["detail"]


def test_no_request_in_the_no_form_evening(client, db, riya):
    set_rules(db, "open", needs_form=True, free=True)
    r = send(client, riya)
    assert r.status_code == 403
    assert "no request is needed" in r.json()["detail"]


def test_requests_only_until_the_window_closes(client, db, riya):
    set_rules(db, "closed", needs_form=True)
    assert send(client, riya).status_code == 403


def test_students_cannot_decide_or_list_requests(client, riya, form_day):
    request = send(client, riya).json()
    assert decide(client, riya, request["id"]).status_code == 403
    assert client.get("/admin/requests", headers=riya).status_code == 403


def test_students_cannot_cancel_someone_elses_request(client, riya, form_day):
    request = send(client, riya).json()
    _, arjun = signup(client, "arjun@geu.ac.in", "Arjun")
    assert client.delete(f"/outings/request/{request['id']}", headers=arjun).status_code == 404


@pytest.mark.parametrize(
    "phone",
    ["12345", "5876543210", "98765-4321", "+12", "call me"],
)
def test_phone_numbers_are_checked(client, riya, form_day, phone):
    assert send(client, riya, phone=phone).status_code == 422


def test_sending_a_form_saves_the_contacts_to_the_profile(client, riya, form_day):
    send(client, riya)
    profile = client.get("/profile", headers=riya).json()
    assert profile["phone"] == "+919876543210"
    assert profile["emergency_name"] == "Sunita Sharma"


# ---------- profile and hostels ----------


def test_a_hostel_brings_its_rules(client, db, riya, warden):
    sets = client.get("/admin/rule-sets", headers=warden).json()
    default = sets[0]
    strict = {
        "name": "Strict",
        "days": [
            {"day_type": d, "opens_at": "00:00", "return_by": "00:30"}
            for d in ("weekday", "saturday", "sunday", "holiday")
        ],
    }
    created = client.post("/admin/rule-sets", json=strict, headers=warden)
    assert created.status_code == 201, created.text
    strict_id = next(s["id"] for s in created.json() if s["name"] == "Strict")
    hostel = client.post(
        "/admin/hostels",
        json={"name": "Hostel 3", "rule_set_id": strict_id, "warden_phone": "9876500000"},
        headers=warden,
    )
    assert hostel.status_code == 201, hostel.text

    choices = client.get("/hostels", headers=riya).json()
    assert [(c["name"], c["rule_set"]) for c in choices] == [("Hostel 3", "Strict")]
    r = client.patch("/profile", json={"hostel_id": choices[0]["id"]}, headers=riya)
    assert r.status_code == 200 and r.json()["hostel"] == "Hostel 3"

    today = client.get("/campus", headers=riya).json()["today"]
    assert (today["rule_set"], today["hostel"]) == ("Strict", "Hostel 3")
    assert default["is_default"] is True

    # A student whose hostel is deleted falls back to the default rules.
    assert client.delete(f"/admin/hostels/{choices[0]['id']}", headers=warden).status_code == 200
    assert client.get("/campus", headers=riya).json()["today"]["rule_set"] == default["name"]


def test_profile_contacts(client, riya):
    r = client.patch(
        "/profile",
        json={
            "contacts": {
                "phone": "09876543210",
                "emergency_name": "Arjun",
                "emergency_relation": "Friend",
                "emergency_phone": "+44 7700 900123",
            }
        },
        headers=riya,
    )
    assert r.status_code == 200, r.text
    assert r.json()["phone"] == "+919876543210"
    assert r.json()["emergency_phone"] == "+447700900123"  # other countries keep their code


def test_unknown_hostel_is_refused(client, riya):
    r = client.patch(
        "/profile", json={"hostel_id": "00000000-0000-4000-8000-000000000000"}, headers=riya
    )
    assert r.status_code == 422


def test_rule_set_edits_are_validated(client, warden):
    bad = {
        "name": "Bad",
        "days": [
            {"day_type": "weekday", "opens_at": "20:00", "return_by": "18:00"},
            {"day_type": "saturday", "opens_at": "10:00", "return_by": "20:00"},
            {"day_type": "sunday", "opens_at": "10:00", "return_by": "20:00"},
            {"day_type": "holiday", "opens_at": "10:00", "return_by": "20:00"},
        ],
    }
    assert client.post("/admin/rule-sets", json=bad, headers=warden).status_code == 422
    missing = {**bad, "days": bad["days"][1:] + bad["days"][1:2]}
    assert client.post("/admin/rule-sets", json=missing, headers=warden).status_code == 422


def test_no_form_evening_is_saved_only_on_form_days(client, warden):
    def day(d, **extra):
        return {"day_type": d, "opens_at": "10:00", "return_by": "20:00", **extra}

    body = {
        "name": "Evenings",
        "days": [
            day("weekday", no_form_from="18:00"),  # not a form day: dropped
            day("saturday"),
            day("sunday", needs_form=True, max_minutes=180, no_form_from="18:00"),
            day("holiday", needs_form=True),
        ],
    }
    r = client.post("/admin/rule-sets", json=body, headers=warden)
    assert r.status_code == 201, r.text
    saved = {d["day_type"]: d for s in r.json() if s["name"] == "Evenings" for d in s["days"]}
    assert saved["sunday"]["no_form_from"] == "18:00"
    assert saved["weekday"]["no_form_from"] is None
    assert saved["holiday"]["no_form_from"] is None

    late = {
        **body,
        "name": "Late",
        "days": [
            *body["days"][:2],
            day("sunday", needs_form=True, no_form_from="20:00"),
            body["days"][3],
        ],
    }
    assert client.post("/admin/rule-sets", json=late, headers=warden).status_code == 422


def test_the_default_rule_set_cannot_be_deleted(client, warden):
    default = client.get("/admin/rule-sets", headers=warden).json()[0]
    r = client.delete(f"/admin/rule-sets/{default['id']}", headers=warden)
    assert r.status_code == 409


def test_holidays_turn_a_weekday_into_a_holiday(client, db, riya, warden):
    today = (datetime.now(UTC) + timedelta(hours=5, minutes=30)).date().isoformat()
    r = client.put(
        f"/admin/holidays/{today}", json={"day": today, "name": "Founders' Day"}, headers=warden
    )
    assert r.status_code == 200, r.text
    rules_today = client.get("/campus", headers=riya).json()["today"]
    assert (rules_today["day_type"], rules_today["label"]) == ("holiday", "Founders' Day")
    assert client.get("/admin/holidays", headers=warden).json() == [
        {"day": today, "name": "Founders' Day"}
    ]
    assert client.delete(f"/admin/holidays/{today}", headers=warden).status_code == 204
    assert db.execute(text("SELECT count(*) FROM holidays")).scalar_one() == 0


def test_a_holiday_cant_be_set_for_a_day_already_past(client, db, warden):
    """Past days are history: a holiday added now would rewrite the rules they ran under."""
    yesterday = (ist_today() - timedelta(days=1)).isoformat()
    r = client.put(
        f"/admin/holidays/{yesterday}",
        json={"day": yesterday, "name": "Founders' Day"},
        headers=warden,
    )
    assert r.status_code == 422
    assert r.json()["detail"] == "That day has already passed"
    assert db.execute(text("SELECT count(*) FROM holidays")).scalar_one() == 0


def test_a_holiday_on_a_day_already_past_cant_be_deleted(client, db, warden):
    """Deleting a past holiday rewrites history as much as adding one would."""
    yesterday = ist_today() - timedelta(days=1)
    db.execute(
        text("INSERT INTO holidays (day, name) VALUES (:d, 'Founders'' Day')"), {"d": yesterday}
    )
    db.commit()
    r = client.delete(f"/admin/holidays/{yesterday.isoformat()}", headers=warden)
    assert r.status_code == 422, r.text
    assert r.json()["detail"] == "That day has already passed"
    assert db.execute(text("SELECT count(*) FROM holidays")).scalar_one() == 1


def test_admin_rules_pages_are_admin_only(client, riya):
    for path in ("/admin/rule-sets", "/admin/hostels", "/admin/holidays"):
        assert client.get(path, headers=riya).status_code == 403


# ---------- what the student is told, and when admins can decide ----------


@pytest.fixture
def push(client):
    from app.push import MemoryPushSender

    sender = MemoryPushSender()
    client.app.state.push = sender
    return sender


def ist_today():
    return (datetime.now(UTC) + timedelta(hours=5, minutes=30)).date()


def insert_request(db, day, status="pending") -> str:
    return str(
        db.execute(
            text(
                "INSERT INTO outing_requests (student_id, day, purpose, phone, emergency_name, "
                "emergency_relation, emergency_phone, status) "
                "SELECT id, :d, 'Trip', '+919876543210', 'Sunita', 'Mother', '+919123456789', "
                ":s FROM users WHERE email = 'riya@geu.ac.in' "
                "RETURNING id"
            ),
            {"d": day, "s": status},
        ).scalar_one()
    )


def test_a_refused_tap_out_explains_todays_request(client, riya, warden, form_day):
    def refusal() -> str:
        r = client.post("/outings", json={}, headers=riya)
        assert r.status_code == 403, r.text
        return r.json()["detail"]

    assert refusal().endswith(  # starts with the day's label ("Sunday", a holiday's name)
        " outings need an approved request. Ask for today's outing in Lumiback "
        "(Today in the app, Home on the website), then tap out once it's approved."
    )
    request = send(client, riya).json()
    assert refusal() == "Your request for today is waiting for the hostel office's approval."
    decide(client, warden, request["id"], approve=False)
    assert refusal() == "Your request for today was declined. You can send a new one."

    request = send(client, riya).json()
    decide(client, warden, request["id"])
    assert client.post("/outings", json={}, headers=riya).status_code == 201
    client.post("/outings/current/return", headers=riya)
    assert refusal() == (
        "You've used today's approved outing. To go out again, ask for another outing in "
        "Lumiback and tap out once it's approved."
    )


def test_after_a_used_approval_the_student_can_ask_for_another_outing(
    client, riya, warden, form_day
):
    first = send(client, riya).json()
    assert first["again"] is False
    decide(client, warden, first["id"])
    assert client.post("/outings", json={}, headers=riya).status_code == 201
    client.post("/outings/current/return", headers=riya)

    again = send(client, riya)
    assert again.status_code == 201, again.text
    second = again.json()
    assert second["again"] is True and second["used"] is False
    assert send(client, riya).status_code == 409  # one live request at a time
    queue = client.get("/admin/requests", headers=warden).json()
    assert {r["id"]: r["again"] for r in queue} == {first["id"]: False, second["id"]: True}

    # Still needs approval: no tap-out until the warden says yes.
    assert client.post("/outings", json={}, headers=riya).status_code == 403
    decide(client, warden, second["id"])
    assert client.post("/outings", json={}, headers=riya).status_code == 201
    assert client.get("/outings/request", headers=riya).json()["used"] is True


def add_student_requests(db, email: str, name: str, *, used_first: bool) -> None:
    """A student of a hostel of their own with today's pending request; `used_first`: after an
    approval (by the warden) already used for an outing, so the pending one is asked "again"."""
    db.execute(
        text(
            "INSERT INTO hostels (name, rule_set_id) "
            "SELECT :h, default_rule_set_id FROM campus_settings"
        ),
        {"h": f"{name}'s hostel"},
    )
    db.execute(
        text(
            "INSERT INTO users (name, email, password_hash, email_verified_at, hostel_id) "
            "SELECT :n, :e, 'x', now(), id FROM hostels WHERE name = :h"
        ),
        {"n": name, "e": email, "h": f"{name}'s hostel"},
    )
    values = "SELECT id, :d, 'Trip', '+919876543210', 'Sunita', 'Mother', '+919123456789'"
    columns = (
        "INSERT INTO outing_requests (student_id, day, purpose, phone, emergency_name, "
        "emergency_relation, emergency_phone"
    )
    if used_first:
        used = db.execute(
            text(
                f"{columns}, status, used_at, created_at, decided_by, decided_at) {values}, "  # noqa: S608
                "'approved', now(), now() - interval '1 hour', "
                "(SELECT id FROM users WHERE email = 'warden@geu.ac.in'), now() "
                "FROM users WHERE email = :e RETURNING id"
            ),
            {"d": ist_today(), "e": email},
        ).scalar_one()
        db.execute(
            text(
                "INSERT INTO outings (student_id, left_at, expected_return_at, returned_at, "
                "request_id) SELECT id, now() - interval '50 minutes', now() + interval '1 hour', "
                "now() - interval '10 minutes', :r FROM users WHERE email = :e"
            ),
            {"r": used, "e": email},
        )
    db.execute(
        text(f"{columns}) {values} FROM users WHERE email = :e"),  # noqa: S608
        {"d": ist_today(), "e": email},
    )
    db.commit()


def test_the_queue_reads_used_and_again_in_a_fixed_number_of_queries(client, db, warden):
    from sqlalchemy import event

    engine = client.app.state.sessionmaker.kw["bind"].sync_engine
    statements: list[str] = []

    def count(_conn, _cursor, statement, *_):
        statements.append(statement)

    def queue() -> tuple[list[dict], int]:
        statements.clear()
        event.listen(engine, "before_cursor_execute", count)
        try:
            r = client.get("/admin/requests", headers=warden)
        finally:
            event.remove(engine, "before_cursor_execute", count)
        assert r.status_code == 200, r.text
        return r.json(), len(statements)

    add_student_requests(db, "asha@geu.ac.in", "Asha", used_first=True)
    add_student_requests(db, "bela@geu.ac.in", "Bela", used_first=False)
    _, few = queue()
    add_student_requests(db, "cara@geu.ac.in", "Cara", used_first=True)
    add_student_requests(db, "dev@geu.ac.in", "Dev", used_first=False)
    rows, more = queue()

    assert more == few  # twice the rows, no more queries
    assert sorted((r["name"], r["status"], r["used"], r["again"]) for r in rows) == [
        ("Asha", "approved", True, False),
        ("Asha", "pending", False, True),
        ("Bela", "pending", False, False),
        ("Cara", "approved", True, False),
        ("Cara", "pending", False, True),
        ("Dev", "pending", False, False),
    ]
    assert {(r["name"], r["hostel"], r["decided_by"], r["max_minutes"]) for r in rows} == {
        ("Asha", "Asha's hostel", "Warden", None),
        ("Asha", "Asha's hostel", None, None),
        ("Bela", "Bela's hostel", None, None),
        ("Cara", "Cara's hostel", "Warden", None),
        ("Cara", "Cara's hostel", None, None),
        ("Dev", "Dev's hostel", None, None),
    }


def test_a_used_approval_stays_used_even_without_its_outing_row(client, db, riya, warden, form_day):
    first = send(client, riya).json()
    decide(client, warden, first["id"])
    assert client.post("/outings", json={}, headers=riya).status_code == 201
    client.post("/outings/current/return", headers=riya)
    db.execute(text("DELETE FROM outings"))  # e.g. removed by retention
    db.commit()
    assert client.post("/outings", json={}, headers=riya).status_code == 403


def test_a_refusal_mentions_the_no_form_evening(client, db, riya, form_day):
    db.execute(text("UPDATE day_rules SET no_form_from = CAST('23:58' AS time)"))
    db.commit()
    r = client.post("/outings", json={}, headers=riya)
    assert r.status_code == 403
    assert r.json()["detail"].endswith(" From 11:58 PM you can go out without one.")


def test_a_pending_request_still_says_ask_to_cancel(client, riya, form_day):
    send(client, riya)
    r = send(client, riya)
    assert r.status_code == 409
    assert r.json()["detail"].startswith("You already asked for today's outing.")


def test_limits_in_hours_and_minutes(client, db, riya):
    set_rules(db, "open", max_minutes=90, needs_form=True)
    r = send(client, riya, requested_minutes=120)
    assert r.status_code == 403
    assert r.json()["detail"] == "Today you can go out for at most 1 h 30 min."


def test_requests_are_decided_on_their_own_day(client, db, riya, warden, form_day):
    stale = insert_request(db, ist_today() - timedelta(days=1))
    db.commit()
    for approve in (True, False):
        r = decide(client, warden, stale, approve=approve)
        assert r.status_code == 409
        assert r.json()["detail"] == "This request was for another day."


def test_no_approval_after_todays_hours(client, db, riya, warden, form_day):
    request = send(client, riya).json()
    set_rules(db, "closed", max_minutes=180, needs_form=True)
    r = decide(client, warden, request["id"])
    assert r.status_code == 409
    assert r.json()["detail"] == "Today's outing hours are over, so this can't be approved."
    declined = decide(client, warden, request["id"], approve=False)  # declining still works
    assert declined.status_code == 200 and declined.json()["status"] == "declined"


def test_the_approval_push_matches_the_email(client, riya, warden, push, form_day):
    from tests.test_push import register_token

    register_token(client, riya)
    request = send(client, riya).json()
    assert decide(client, warden, request["id"]).status_code == 200
    _, message = push.outbox[-1]
    assert message.title == "Outing request approved"
    assert message.body == "Tap out at the gate, or log the trip in Lumiback."
    assert message.channel == "share-status"
    assert (message.tag, message.ttl) == (f"request:{request['id']}", 24 * 3600)


def test_the_limit_shown_is_for_the_requests_own_day(client, db, riya, warden, form_day):
    other = ist_today() - timedelta(days=1)
    # A past day can't be made a holiday through the API any more; it was one at the time.
    db.execute(text("INSERT INTO holidays (day, name) VALUES (:d, 'Founders'' Day')"), {"d": other})
    db.execute(text("UPDATE day_rules SET max_minutes = 240 WHERE day_type = 'holiday'"))
    insert_request(db, other)
    insert_request(db, other - timedelta(days=7))  # same weekday a week before: not a holiday
    db.commit()
    send(client, riya)

    assert [q["max_minutes"] for q in client.get("/admin/requests", headers=warden).json()] == [180]
    [then] = client.get(f"/admin/requests?day={other}", headers=warden).json()
    assert then["max_minutes"] == 240
    week = other - timedelta(days=7)
    [before] = client.get(f"/admin/requests?day={week}", headers=warden).json()
    assert before["max_minutes"] == 180


# ---------- hostel changes ----------


def hostel_for(client, warden, name: str = "Hostel 3") -> str:
    default = client.get("/admin/rule-sets", headers=warden).json()[0]
    r = client.post(
        "/admin/hostels", json={"name": name, "rule_set_id": default["id"]}, headers=warden
    )
    assert r.status_code == 201, r.text
    return next(h["id"] for h in r.json() if h["name"] == name)


HOSTEL_IN_USE = (
    "You can't change your hostel while you're out or have an outing request for today. "
    "Ask the hostel office."
)
HOSTEL_SET = "Your hostel is set. Ask the hostel office if you've moved."


def riya_id(client, warden) -> str:
    return client.get("/admin/users", params={"q": "riya"}, headers=warden).json()[0]["id"]


def move(client, warden, student: str, hostel: str):
    return client.post(
        f"/admin/students/{student}/hostel", json={"hostel_id": hostel}, headers=warden
    )


def test_a_student_picks_their_hostel_once(client, riya, warden):
    first, other = hostel_for(client, warden), hostel_for(client, warden, "Hostel 4")
    assert client.get("/profile", headers=riya).json()["hostel_locked"] is False
    r = client.patch("/profile", json={"hostel_id": first}, headers=riya)
    assert r.status_code == 200 and r.json()["hostel_locked"] is True
    # No switching to a hostel with easier rules (or a different warden), nor leaving the list.
    for change in (other, None):
        r = client.patch("/profile", json={"hostel_id": change}, headers=riya)
        assert r.status_code == 403 and r.json()["detail"] == HOSTEL_SET
    # Resending the same hostel, or only the contacts, isn't a change.
    assert client.patch("/profile", json={"hostel_id": first}, headers=riya).status_code == 200
    assert client.get("/profile", headers=riya).json()["hostel"] == "Hostel 3"


def test_the_first_pick_waits_until_back(client, db, riya, warden):
    hostel = hostel_for(client, warden)
    set_rules(db, "open")
    assert client.post("/outings", json={}, headers=riya).status_code == 201
    r = client.patch("/profile", json={"hostel_id": hostel}, headers=riya)
    assert r.status_code == 409 and r.json()["detail"] == HOSTEL_IN_USE
    client.post("/outings/current/return", headers=riya)
    r = client.patch("/profile", json={"hostel_id": hostel}, headers=riya)
    assert r.status_code == 200 and r.json()["hostel"] == "Hostel 3"


def test_the_office_moves_a_student_but_not_mid_outing(client, riya, warden, form_day):
    first, other = hostel_for(client, warden), hostel_for(client, warden, "Hostel 4")
    assert client.patch("/profile", json={"hostel_id": first}, headers=riya).status_code == 200
    student = riya_id(client, warden)
    request = send(client, riya).json()
    # A request for today: that hostel's rules and office already apply.
    assert move(client, warden, student, other).status_code == 409
    assert decide(client, warden, request["id"]).status_code == 200
    assert move(client, warden, student, other).status_code == 409  # approved, not yet used
    assert client.post("/outings", json={}, headers=riya).status_code == 201
    assert move(client, warden, student, other).status_code == 409  # out
    assert client.post("/outings/current/return", headers=riya).status_code == 200
    # Back, and the approval is spent: the office can move them.
    r = move(client, warden, student, other)
    assert r.status_code == 200 and r.json()["hostel"] == "Hostel 4", r.text
    assert client.get("/profile", headers=riya).json()["hostel"] == "Hostel 4"
    # Moving to where they already are is fine; an unknown hostel isn't.
    assert move(client, warden, student, other).status_code == 200
    bad = move(client, warden, student, "00000000-0000-4000-8000-000000000000")
    assert bad.status_code == 422


def test_students_cant_use_the_move_endpoint(client, riya, warden):
    hostel = hostel_for(client, warden)
    r = move(client, riya, riya_id(client, warden), hostel)
    assert r.status_code == 403


# ---------- rule-set save errors ----------


def rule_set(name: str) -> dict:
    return {
        "name": name,
        "days": [
            {"day_type": d, "opens_at": "10:00", "return_by": "20:00"}
            for d in ("weekday", "saturday", "sunday", "holiday")
        ],
    }


def test_a_taken_rule_set_name_is_a_conflict(client, warden):
    assert (
        client.post("/admin/rule-sets", json=rule_set("Girls"), headers=warden).status_code == 201
    )
    r = client.post("/admin/rule-sets", json=rule_set("Girls"), headers=warden)
    assert r.status_code == 409 and r.json()["detail"] == "That name is already used"
    other = client.post("/admin/rule-sets", json=rule_set("Boys"), headers=warden).json()
    boys = next(s["id"] for s in other if s["name"] == "Boys")
    r = client.put(f"/admin/rule-sets/{boys}", json=rule_set("Girls"), headers=warden)
    assert r.status_code == 409 and r.json()["detail"] == "That name is already used"


def test_other_database_refusals_are_not_called_a_taken_name(client, warden, monkeypatch):
    """A day rule the database refuses (the schema normally stops it first) is a 422, not a
    500 and not "name taken"."""
    from app.api import admin_rules

    real = admin_rules._apply_days

    def too_short(rule_set_id, days):
        rules = real(rule_set_id, days)
        rules[0].max_minutes = 5  # below the day_rules max_range check
        return rules

    monkeypatch.setattr(admin_rules, "_apply_days", too_short)
    expected = "These rules aren't valid. Check the times."
    r = client.post("/admin/rule-sets", json=rule_set("Odd"), headers=warden)
    assert r.status_code == 422 and r.json()["detail"] == expected
    default = client.get("/admin/rule-sets", headers=warden).json()[0]
    r = client.put(f"/admin/rule-sets/{default['id']}", json=rule_set("Odd"), headers=warden)
    assert r.status_code == 422 and r.json()["detail"] == expected
    assert [s["name"] for s in client.get("/admin/rule-sets", headers=warden).json()] == [
        default["name"]
    ]
