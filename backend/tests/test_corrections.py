"""Outing corrections: the office records or fixes a return, a student asks, and an outing left
open from an earlier day is not closed by the next morning's exit scan."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from app.push import MemoryPushSender
from tests.helpers import GATE, create_gate, kiosk_qr, make_admin, signup
from tests.test_wardens import student

AT_GATE = {"lat": GATE["lat"], "lng": GATE["lng"], "accuracy_m": 8}


@pytest.fixture
def push(client) -> MemoryPushSender:
    sender = MemoryPushSender()
    client.app.state.push = sender
    return sender


def phone(client, headers, token: str) -> dict:
    r = client.post(
        "/devices/push-token", json={"token": token, "platform": "android"}, headers=headers
    )
    assert r.status_code == 204, r.text
    return headers


def pushed(push: MemoryPushSender) -> list[str]:
    return [m.title for _, m in push.outbox]


@pytest.fixture
def office(client, db):
    headers = signup(client, "office@geu.ac.in", "Office")[1]
    make_admin(db, "office@geu.ac.in")
    return phone(client, headers, "ExponentPushToken[officePhone001]")


@pytest.fixture
def riya(client):
    headers = signup(client, "riya@geu.ac.in", "Riya")[1]
    return phone(client, headers, "ExponentPushToken[riyaPhone00001]")


def go_out(client, db, headers, hours_ago: float = 3) -> dict:
    """An outing that started `hours_ago` (moved back in the database)."""
    r = client.post("/outings", json={"destination": "Rajpur Road"}, headers=headers)
    assert r.status_code == 201, r.text
    db.execute(
        text(
            "UPDATE outings SET left_at = left_at - make_interval(secs => :s), "
            "expected_return_at = expected_return_at - make_interval(secs => :s) WHERE id = :id"
        ),
        {"s": hours_ago * 3600, "id": r.json()["id"]},
    )
    db.commit()
    return r.json()


def outing_row(db, outing_id: str):
    return db.execute(
        text("SELECT left_at, returned_at, in_via FROM outings WHERE id = :id"),
        {"id": outing_id},
    ).one()


def ago(hours: float) -> str:
    return (datetime.now(UTC) - timedelta(hours=hours)).isoformat()


def correct(client, headers, outing_id, **body):
    return client.post(f"/admin/outings/{outing_id}/correction", json=body, headers=headers)


def ask(client, headers, outing_id, **body):
    return client.post(f"/outings/{outing_id}/correction", json=body, headers=headers)


# ---------- the office corrects directly ----------


def test_the_office_records_a_forgotten_return(client, db, office, riya, push):
    outing = go_out(client, db, riya, hours_ago=3)
    r = correct(
        client, office, outing["id"], kind="return", returned_at=ago(2), reason="Seen at 7:40"
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "returned" and r.json()["in_via"] == "staff"
    left, returned, via = outing_row(db, outing["id"])
    assert via == "staff" and abs((returned - left) - timedelta(hours=1)) < timedelta(seconds=5)
    assert client.get("/outings/current", headers=riya).json() is None  # they're in

    history = client.get("/outings", headers=riya).json()["items"][0]
    c = history["correction"]
    assert c["kind"] == "return" and c["status"] == "approved" and c["by_staff"] is True
    assert c["old_returned_at"] is None and c["reason"] == "Seen at 7:40"
    audit = db.execute(text("SELECT action, target FROM admin_audit")).all()
    assert ("outing:return", "riya@geu.ac.in") in [tuple(a) for a in audit]
    assert "Your outing was updated" in pushed(push)


def test_a_return_time_must_be_between_leaving_and_now(client, db, office, riya):
    outing = go_out(client, db, riya, hours_ago=3)
    early = correct(client, office, outing["id"], kind="return", returned_at=ago(4), reason="x y")
    assert early.status_code == 422 and "Pick a later time" in early.json()["detail"]
    future = correct(client, office, outing["id"], kind="return", returned_at=ago(-1), reason="x y")
    assert future.status_code == 422 and "hasn't come yet" in future.json()["detail"]
    missing = correct(client, office, outing["id"], kind="return", reason="x y")
    assert missing.status_code == 422
    assert outing_row(db, outing["id"]).returned_at is None


def test_a_return_cannot_be_after_the_next_outing_started(client, db, office, riya):
    first = go_out(client, db, riya, hours_ago=5)
    client.post("/outings/current/return", headers=riya)
    go_out(client, db, riya, hours_ago=2)  # the next one started 2 hours ago
    r = correct(
        client, office, first["id"], kind="return_time", returned_at=ago(1), reason="Gate log"
    )
    assert r.status_code == 422 and "next outing started" in r.json()["detail"]
    ok = correct(
        client, office, first["id"], kind="return_time", returned_at=ago(4), reason="Gate log"
    )
    assert ok.status_code == 200, ok.text


def test_change_a_return_time_and_cancel_a_mistaken_tap(client, db, office, riya):
    outing = go_out(client, db, riya, hours_ago=3)
    client.post("/outings/current/return", headers=riya)  # self-reported, stamped now
    wrong_kind = correct(
        client, office, outing["id"], kind="return", returned_at=ago(1), reason="abc"
    )
    assert wrong_kind.status_code == 409
    r = correct(client, office, outing["id"], kind="return_time", returned_at=ago(2), reason="CCTV")
    assert r.status_code == 200, r.text
    c = client.get("/outings", headers=riya).json()["items"][0]["correction"]
    assert c["old_returned_at"] is not None  # the self-reported time is kept

    r = correct(client, office, outing["id"], kind="cancel", reason="Tapped by mistake")
    assert r.status_code == 200, r.text
    left, returned, via = outing_row(db, outing["id"])
    assert returned == left and via == "staff"
    kinds = db.execute(
        text("SELECT kind, status FROM outing_corrections ORDER BY created_at")
    ).all()
    assert [tuple(k) for k in kinds] == [("return_time", "approved"), ("cancel", "approved")]


def test_the_office_lists_todays_returns_to_correct(client, db, office, riya):
    still_out = signup(client, "aman@geu.ac.in", "Aman")[1]
    go_out(client, db, still_out, hours_ago=1)
    back = go_out(client, db, riya, hours_ago=0.5)
    client.post("/outings/current/return", headers=riya)
    rows = client.get("/admin/outings", params={"state": "back"}, headers=office).json()
    assert [r["id"] for r in rows] == [back["id"]]
    assert rows[0]["status"] == "returned"


def test_cancelling_an_open_outing_closes_it(client, db, office, riya):
    outing = go_out(client, db, riya, hours_ago=0.1)
    assert (
        correct(client, office, outing["id"], kind="cancel", reason="Wrong button").status_code
        == 200
    )
    left, returned, _ = outing_row(db, outing["id"])
    assert returned == left


def test_wardens_correct_only_their_hostels_outings(client, db, office):
    default = next(
        r for r in client.get("/admin/rule-sets", headers=office).json() if r["is_default"]
    )
    ids = {}
    for name in ("A", "B"):
        r = client.post(
            "/admin/hostels",
            json={"name": f"Hostel {name}", "rule_set_id": default["id"]},
            headers=office,
        )
        ids[name] = next(h["id"] for h in r.json() if h["name"] == f"Hostel {name}")
    anna = student(client, "anna@geu.ac.in", "Anna", ids["A"])
    bina = student(client, "bina@geu.ac.in", "Bina", ids["B"])
    warden = signup(client, "warden.a@geu.ac.in", "Warden A")[1]
    wid = client.get("/admin/users", params={"q": "warden.a"}, headers=office).json()[0]["id"]
    client.post(
        f"/admin/users/{wid}/role",
        json={"role": "warden", "hostel_ids": [ids["A"]]},
        headers=office,
    )
    a, b = go_out(client, db, anna), go_out(client, db, bina)
    body = {"kind": "return", "returned_at": ago(1), "reason": "Seen at the gate"}
    assert correct(client, warden, b["id"], **body).status_code == 404
    assert correct(client, warden, a["id"], **body).status_code == 200
    assert correct(client, anna, a["id"], **body).status_code == 403  # students can't


# ---------- a student asks ----------


def test_a_student_asks_and_the_office_approves(client, db, office, riya, push):
    outing = go_out(client, db, riya, hours_ago=3)
    r = ask(client, riya, outing["id"], kind="return", returned_at=ago(2), reason="Kiosk was off")
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "pending" and r.json()["by_staff"] is False
    assert outing_row(db, outing["id"]).returned_at is None  # nothing changes yet
    assert "Outing correction asked" in pushed(push)

    again = ask(client, riya, outing["id"], kind="cancel", reason="Actually never left")
    assert again.status_code == 409

    queue = client.get("/admin/corrections", headers=office).json()
    assert [q["outing"]["id"] for q in queue["asks"]] == [outing["id"]]
    assert client.get("/admin/overview", headers=office).json()["corrections"] == 1
    cid = queue["asks"][0]["correction"]["id"]

    d = client.post(f"/admin/corrections/{cid}/decision", json={"approve": True}, headers=office)
    assert d.status_code == 200, d.text
    assert d.json()["status"] == "approved"
    left, returned, via = outing_row(db, outing["id"])
    assert via == "staff" and abs((returned - left) - timedelta(hours=1)) < timedelta(seconds=5)
    assert client.get("/admin/corrections", headers=office).json()["asks"] == []
    assert "Correction approved" in pushed(push)
    twice = client.post(
        f"/admin/corrections/{cid}/decision", json={"approve": True}, headers=office
    )
    assert twice.status_code == 409


def test_a_declined_ask_changes_nothing(client, db, office, riya, push):
    outing = go_out(client, db, riya, hours_ago=3)
    client.post("/outings/current/return", headers=riya)
    before = outing_row(db, outing["id"])
    cid = ask(client, riya, outing["id"], kind="cancel", reason="I never went").json()["id"]
    d = client.post(
        f"/admin/corrections/{cid}/decision",
        json={"approve": False, "note": "The gate saw you leave."},
        headers=office,
    )
    assert d.status_code == 200 and d.json()["status"] == "declined"
    assert outing_row(db, outing["id"]) == before
    c = client.get("/outings", headers=riya).json()["items"][0]["correction"]
    assert c["status"] == "declined" and c["note"] == "The gate saw you leave."


def test_students_ask_only_about_their_own_recent_outings(client, db, office, riya):
    outing = go_out(client, db, riya, hours_ago=3)
    other = signup(client, "aman@geu.ac.in", "Aman")[1]
    body = {"kind": "return", "returned_at": ago(2), "reason": "Forgot to tap"}
    assert ask(client, other, outing["id"], **body).status_code == 404
    client.post("/outings/current/return", headers=riya)
    db.execute(
        text(
            "UPDATE outings SET left_at = left_at - interval '9 days', "
            "expected_return_at = expected_return_at - interval '9 days', "
            "returned_at = returned_at - interval '8 days'"
        )
    )
    db.commit()
    old = ask(client, riya, outing["id"], kind="cancel", reason="Wrong tap")
    assert old.status_code == 409 and "last 7 days" in old.json()["detail"]


def test_an_office_correction_answers_a_pending_ask(client, db, office, riya):
    outing = go_out(client, db, riya, hours_ago=3)
    ask(client, riya, outing["id"], kind="return", returned_at=ago(2), reason="Forgot to tap")
    r = correct(client, office, outing["id"], kind="return", returned_at=ago(1), reason="Seen")
    assert r.status_code == 200, r.text
    statuses = db.execute(
        text("SELECT by_staff, status FROM outing_corrections ORDER BY created_at")
    ).all()
    assert [tuple(s) for s in statuses] == [(False, "cancelled"), (True, "approved")]


def test_an_ask_approved_after_the_student_tapped_in_fixes_that_return(client, db, office, riya):
    outing = go_out(client, db, riya, hours_ago=3)
    cid = ask(
        client, riya, outing["id"], kind="return", returned_at=ago(2), reason="Kiosk off"
    ).json()["id"]
    client.post("/outings/current/return", headers=riya)  # then reported "I'm back" now
    d = client.post(f"/admin/corrections/{cid}/decision", json={"approve": True}, headers=office)
    assert d.status_code == 200, d.text
    assert d.json()["old_returned_at"] is not None
    left, returned, _ = outing_row(db, outing["id"])
    assert abs((returned - left) - timedelta(hours=1)) < timedelta(seconds=5)


# ---------- an outing left open from an earlier day, at the gate ----------


@pytest.fixture
def gate(client, office):
    return create_gate(client, office)


def scan(client, headers, gate, **extra):
    qr = kiosk_qr(client, gate["kiosk_token"])
    return client.post("/gates/scan", json={"qr": qr, **AT_GATE, **extra}, headers=headers)


def test_the_gate_asks_before_closing_yesterdays_outing(client, db, office, riya, gate):
    old = go_out(client, db, riya, hours_ago=26)
    r = scan(client, riya, gate, ask_if_stale=True)
    assert r.status_code == 409, r.text
    detail = r.json()["detail"]
    assert detail["code"] == "stale_outing" and "never closed" in detail["message"]
    assert outing_row(db, old["id"]).returned_at is None
    assert db.execute(text("SELECT count(*) FROM gate_scans")).scalar_one() == 0
    # An app from before 1.10.0 can only show text.
    older = scan(client, riya, gate)
    assert older.status_code == 409
    assert "Tap I'm back in the app" in older.json()["detail"]

    out = scan(client, riya, gate, intent="out")
    assert out.status_code == 200, out.text
    assert out.json()["direction"] == "out" and out.json()["outing"]["id"] != old["id"]
    assert outing_row(db, old["id"]).in_via == "unrecorded"

    queue = client.get("/admin/corrections", headers=office).json()
    assert [o["id"] for o in queue["unrecorded"]] == [old["id"]]
    assert client.get("/admin/overview", headers=office).json()["corrections"] == 1
    # An unknown return time isn't counted as late.
    assert client.get("/outings/summary", headers=riya).json()["returned_late"] == 0

    fixed = correct(
        client, office, old["id"], kind="return_time", returned_at=ago(24), reason="Hostel log"
    )
    assert fixed.status_code == 200, fixed.text
    assert client.get("/admin/corrections", headers=office).json()["unrecorded"] == []


def test_coming_back_in_closes_yesterdays_outing_normally(client, db, riya, gate):
    old = go_out(client, db, riya, hours_ago=26)
    r = scan(client, riya, gate, intent="in")
    assert r.status_code == 200, r.text
    assert r.json()["direction"] == "in" and r.json()["outing"]["id"] == old["id"]
    assert outing_row(db, old["id"]).in_via == "gate"


def test_todays_outing_is_closed_by_a_scan_without_asking(client, db, riya, gate):
    today = go_out(client, db, riya, hours_ago=0.01)
    r = scan(client, riya, gate, intent="out")  # ignored: nothing stale
    assert r.status_code == 200, r.text
    assert r.json()["direction"] == "in" and r.json()["outing"]["id"] == today["id"]
