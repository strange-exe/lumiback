"""Wave 3 #8, running late (owner 2026-11-08: "Yes, within a cap"): a student who is out tells
the hostel office they'll be 15, 30 or 60 minutes late, once per outing, until the late alert
has gone. The due time moves, so the late alert and the escalation run from the new time; the
office is told (not urgently) and sees the original time, the new one and the reason.
"""

from datetime import datetime, timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from tests import test_alerts as base
from tests.test_alerts import (
    ADMIN,
    ANNA,
    HEAD,
    WARDEN_A,
    WARDEN_B,
    go_out,
    mail_to,
    run_sweep,
    sent_to,
    staff,
)

# The wave 2 fixtures (two hostels, their office, Anna of hostel A with a phone).
many_sign_ups = base.many_sign_ups
push, mailer, admin = base.push, base.mailer, base.admin
hostels, office, anna = base.hostels, base.office, base.anna

ALREADY = "You've already told the hostel office you're running late on this outing."
ALERT_GONE = "The late alert has already gone out. Answer it, or call the hostel office."
PASSED = "That time has already passed. Choose a longer time."


def current(client, headers) -> dict:
    r = client.get("/outings/current", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def late(client, headers, minutes, reason=None):
    return client.post(
        "/outings/current/running-late",
        json={"minutes": minutes, "reason": reason},
        headers=headers,
    )


def due_in(db, minutes: int) -> None:
    """The open outing is due `minutes` from now (negative: that long ago)."""
    db.execute(
        text(
            "UPDATE outings SET left_at = now() - interval '3 hours', "
            "expected_return_at = now() + make_interval(mins => :m) WHERE returned_at IS NULL"
        ),
        {"m": minutes},
    )
    db.commit()


def at(value: str) -> datetime:
    return datetime.fromisoformat(value)


def test_a_student_who_is_out_moves_their_due_time_once(client, db, push, office, anna):
    assert late(client, anna, 30).status_code == 404  # not out
    go_out(client, anna)
    before = current(client, anna)
    assert before["running_late_choices"] == [15, 30, 60]
    assert before["original_return_at"] is None and before["running_late_minutes"] is None

    r = late(client, anna, 30, "  Bus is stuck in traffic  ")
    assert r.status_code == 200, r.text
    moved = r.json()
    assert at(moved["expected_return_at"]) - at(before["expected_return_at"]) == timedelta(
        minutes=30
    )
    assert at(moved["original_return_at"]) == at(before["expected_return_at"])
    assert moved["running_late_minutes"] == 30
    assert moved["running_late_reason"] == "Bus is stuck in traffic"
    assert moved["running_late_at"] is not None
    assert moved["running_late_choices"] == []
    assert current(client, anna)["expected_return_at"] == moved["expected_return_at"]

    # Once per outing, whatever is asked the second time: never more than 60 in all.
    for minutes in (15, 30):
        r = late(client, anna, minutes)
        assert (r.status_code, r.json()["detail"]) == (409, ALREADY)
    assert current(client, anna)["expected_return_at"] == moved["expected_return_at"]

    # The next outing may use it again.
    assert client.post("/outings/current/return", headers=anna).status_code == 200
    go_out(client, anna)
    assert current(client, anna)["running_late_choices"] == [15, 30, 60]


def test_it_is_allowed_until_the_late_alert_and_only_for_a_time_still_ahead(client, db, push, anna):
    go_out(client, anna)
    due_in(db, -20)  # 20 min past due, the alert goes at 30
    assert current(client, anna)["running_late_choices"] == [30, 60]
    r = late(client, anna, 15)
    assert (r.status_code, r.json()["detail"]) == (409, PASSED)
    assert late(client, anna, 30).status_code == 200

    # Another outing, 31 min late: the sweep sends the alert, and then it's too late.
    db.execute(text("UPDATE outings SET returned_at = now() WHERE returned_at IS NULL"))
    db.commit()
    go_out(client, anna)
    due_in(db, -31)
    assert run_sweep(client).overdue_notified == 1
    assert current(client, anna)["running_late_choices"] == []
    r = late(client, anna, 60)
    assert (r.status_code, r.json()["detail"]) == (409, ALERT_GONE)


def test_it_is_refused_once_the_alert_is_due_even_before_the_sweep_sends_it(client, db, push, anna):
    go_out(client, anna)
    due_in(db, -31)  # the alert is due; no sweep has run (behind, or the API was asleep)
    assert current(client, anna)["running_late_choices"] == []
    r = late(client, anna, 60)
    assert (r.status_code, r.json()["detail"]) == (409, ALERT_GONE)
    assert current(client, anna)["original_return_at"] is None


def test_the_export_holds_the_running_late_details(client, db, push, anna):
    go_out(client, anna)
    before = current(client, anna)
    assert late(client, anna, 15, "Missed the bus").status_code == 200
    [outing] = client.get("/profile/export", headers=anna).json()["outings"]
    assert at(outing["original_return_at"]) == at(before["expected_return_at"])
    assert (outing["running_late_minutes"], outing["running_late_reason"]) == (
        15,
        "Missed the bus",
    )
    assert outing["running_late_at"] is not None


def test_the_late_alert_and_escalation_run_from_the_new_time(client, db, push, office, anna):
    go_out(client, anna)
    due_in(db, -25)
    assert late(client, anna, 60).status_code == 200  # now due in 35 min
    db.execute(text("UPDATE outings SET left_at = now() - interval '4 hours'"))  # for the shift
    db.commit()
    shift = (
        "UPDATE outings SET expected_return_at = expected_return_at - make_interval(mins => :m), "
        "original_return_at = original_return_at - make_interval(mins => :m)"
    )
    assert run_sweep(client).overdue_notified == 0  # 25 min past the old time: nothing yet
    # 20 minutes later: 45 past the old time (its alert would have gone), still 15 to go.
    db.execute(text(shift), {"m": 20})
    db.commit()
    assert run_sweep(client).overdue_notified == 0
    # 50 minutes after that: 95 min past the old time, 35 past the new one.
    db.execute(text(shift), {"m": 50})
    db.commit()
    push.outbox.clear()
    assert run_sweep(client).overdue_notified == 1
    [m] = sent_to(push, ANNA)
    assert m.title == "Return overdue: 35 min"
    db.execute(text("UPDATE outings SET overdue_notified_at = now() - interval '11 minutes'"))
    db.commit()
    assert run_sweep(client).escalated == 1
    [e] = client.get("/admin/escalations", headers=office["A"]).json()
    assert e["late_minutes"] == 35


def test_the_office_is_told_not_urgently_and_by_email_without_the_app(
    client, db, push, mailer, admin, hostels, office, anna
):
    staff(client, admin, "warden.a2@geu.ac.in", "Warden A2", "warden", [hostels["A"]])  # no app
    go_out(client, anna)
    due = at(current(client, anna)["expected_return_at"])
    assert late(client, anna, 15, "Missed the bus").status_code == 200
    [m] = sent_to(push, WARDEN_A)
    assert m.title == "Return time updated: Anna"
    new = (due + timedelta(minutes=15)).strftime("%I:%M %p").lstrip("0")
    assert m.body.startswith(f"Due {new} (was ") and "Missed the bus" in m.body
    assert not m.urgent and m.channel == "share-status"
    # The hostel's wardens only (the head wardens step in for a hostel with none).
    assert sent_to(push, WARDEN_B) == [] and sent_to(push, HEAD) == []
    assert sent_to(push, ADMIN) == []
    [mail] = mail_to(mailer, "warden.a2@geu.ac.in")
    assert "running late" in mail.subject.lower()
    assert "Anna" not in mail.subject and "Anna" not in mail.body
    assert "Missed the bus" not in mail.body  # the reason stays behind the sign-in too


def test_the_reason_is_short_plain_text_and_optional(client, db, push, anna):
    go_out(client, anna)
    for body in (
        {"minutes": 20},
        {"minutes": 90},
        {"minutes": 30, "reason": "x" * 121},
        {"minutes": 30, "reason": "line one\nline two"},
        {"minutes": 30, "reason": "hidden" + chr(0x202E)},
        {"minutes": 30, "extra": 1},
    ):
        r = client.post("/outings/current/running-late", json=body, headers=anna)
        assert r.status_code == 422, (body, r.text)
    r = late(client, anna, 30, "   ")
    assert r.status_code == 200, r.text
    assert r.json()["running_late_reason"] is None


def test_the_register_late_list_and_record_show_both_times_and_the_reason(
    client, db, push, admin, office, anna
):
    go_out(client, anna)
    due_in(db, -10)
    assert late(client, anna, 60, "Train delayed").status_code == 200
    original = db.execute(text("SELECT original_return_at FROM outings")).scalar_one()
    [row] = client.get("/admin/outings", headers=office["A"]).json()
    assert (row["running_late_minutes"], row["running_late_reason"]) == (60, "Train delayed")
    assert at(row["original_return_at"]) == original
    assert at(row["expected_return_at"]) - at(row["original_return_at"]) == timedelta(minutes=60)
    assert row["status"] == "out"  # due in 50 min now
    assert client.get("/admin/outings", headers=office["B"]).json() == []
    # Back after the new time: on tonight's late list with both times.
    db.execute(
        text(
            "UPDATE outings SET expected_return_at = now() - interval '5 minutes', "
            "original_return_at = now() - interval '65 minutes', returned_at = now()"
        )
    )
    db.commit()
    [row] = client.get("/admin/late-today", headers=office["A"]).json()
    assert row["running_late_reason"] == "Train delayed" and row["original_return_at"]
    anna_id = row["student_id"]
    [item] = client.get(f"/admin/students/{anna_id}/outings", headers=office["A"]).json()["items"]
    assert (item["running_late_minutes"], item["running_late_reason"]) == (60, "Train delayed")


def test_the_database_holds_the_cap(client, db, push, anna):
    go_out(client, anna)
    assert late(client, anna, 30).status_code == 200
    for sql in (
        # A second move on top of the first: the due time is no longer the original + 30.
        "UPDATE outings SET expected_return_at = expected_return_at + interval '30 minutes'",
        # More than 60 minutes.
        "UPDATE outings SET running_late_minutes = 90, "
        "expected_return_at = original_return_at + interval '90 minutes'",
        # A move without the time it moved from.
        "UPDATE outings SET original_return_at = NULL",
    ):
        with pytest.raises(IntegrityError):
            db.execute(text(sql))
        db.rollback()
