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

    # Leaving the hostel list falls back to the default rules.
    client.patch("/profile", json={"hostel_id": None}, headers=riya)
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
    assert refusal() == "You've used today's approved outing. Form days allow one outing a day."
    again = send(client, riya)
    assert again.status_code == 409
    assert again.json()["detail"] == "You've already used today's approved outing."


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
    assert message.title == "Outing approved"
    assert message.body == "Tap out at the gate when you leave, or log your trip in Lumiback."
    assert message.channel == "share-status"


def test_the_limit_shown_is_for_the_requests_own_day(client, db, riya, warden, form_day):
    other = ist_today() - timedelta(days=1)
    holiday = {"day": other.isoformat(), "name": "Founders' Day"}
    assert client.put(f"/admin/holidays/{other}", json=holiday, headers=warden).status_code == 200
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


def hostel_for(client, warden) -> str:
    default = client.get("/admin/rule-sets", headers=warden).json()[0]
    r = client.post(
        "/admin/hostels", json={"name": "Hostel 3", "rule_set_id": default["id"]}, headers=warden
    )
    assert r.status_code == 201, r.text
    return r.json()[0]["id"]


HOSTEL_LOCKED = (
    "You can't change your hostel while you're out or have an outing request for today. "
    "Ask the hostel office."
)


def test_no_hostel_change_while_out(client, db, riya, warden):
    hostel = hostel_for(client, warden)
    set_rules(db, "open")
    assert client.post("/outings", json={}, headers=riya).status_code == 201
    r = client.patch("/profile", json={"hostel_id": hostel}, headers=riya)  # first pick, too
    assert r.status_code == 409 and r.json()["detail"] == HOSTEL_LOCKED
    assert client.patch("/profile", json={"hostel_id": None}, headers=riya).status_code == 200

    client.post("/outings/current/return", headers=riya)
    r = client.patch("/profile", json={"hostel_id": hostel}, headers=riya)
    assert r.status_code == 200 and r.json()["hostel"] == "Hostel 3"


def test_no_hostel_change_with_a_request_for_today(client, riya, warden, form_day):
    hostel = hostel_for(client, warden)
    assert client.patch("/profile", json={"hostel_id": hostel}, headers=riya).status_code == 200
    request = send(client, riya).json()
    r = client.patch("/profile", json={"hostel_id": None}, headers=riya)
    assert r.status_code == 409 and r.json()["detail"] == HOSTEL_LOCKED
    # Resending the same hostel isn't a change.
    same = client.patch("/profile", json={"hostel_id": hostel}, headers=riya)
    assert same.status_code == 200
    assert client.delete(f"/outings/request/{request['id']}", headers=riya).status_code == 204
    assert client.patch("/profile", json={"hostel_id": None}, headers=riya).status_code == 200


def test_a_used_approval_no_longer_locks_the_hostel(client, riya, warden, form_day):
    hostel = hostel_for(client, warden)
    assert client.patch("/profile", json={"hostel_id": hostel}, headers=riya).status_code == 200
    request = send(client, riya).json()
    assert decide(client, warden, request["id"]).status_code == 200
    # Approved and unused: still locked.
    r = client.patch("/profile", json={"hostel_id": None}, headers=riya)
    assert r.status_code == 409 and r.json()["detail"] == HOSTEL_LOCKED
    assert client.post("/outings", json={}, headers=riya).status_code == 201
    r = client.patch("/profile", json={"hostel_id": None}, headers=riya)  # out: locked
    assert r.status_code == 409
    assert client.post("/outings/current/return", headers=riya).status_code == 200
    # Back, and the approval is spent: the hostel can change again.
    assert client.patch("/profile", json={"hostel_id": None}, headers=riya).status_code == 200


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
