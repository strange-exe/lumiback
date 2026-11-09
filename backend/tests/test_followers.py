"""Wave 3 #15, followers (owner: "not specifically parents, just people who were shared
location with or emergency contact"): the people a student shares their location with see
when the student is due back (a moved time too), and are told when the student is back, 30
min late, running late, or when a share with them times out while the student is still out
(a share the student stops is told to nobody). A follower who no longer follows
gets nothing; the safe-return contact keeps its own emails and isn't told twice.
"""

from datetime import datetime

from sqlalchemy import text

from tests import test_alerts as base
from tests.helpers import befriend, share_with, signup
from tests.test_alerts import ANNA, FRIEND, deliver, go_out, mail_to, rows, run_sweep, sent_to

# The wave 2 fixtures (Anna of hostel A with a phone; a friend she shares her location with).
many_sign_ups = base.many_sign_ups
push, mailer, admin = base.push, base.mailer, base.admin
hostels, anna, friend = base.hostels, base.anna, base.friend

FOLLOW_URL = "/live?view=follow"


def watching(client, headers) -> dict:
    [w] = client.get("/sessions/watching", headers=headers).json()
    return w


def at(value: str) -> datetime:
    return datetime.fromisoformat(value)


def late(client, headers, minutes, reason=None):
    r = client.post(
        "/outings/current/running-late",
        json={"minutes": minutes, "reason": reason},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return r.json()


def due_in(db, minutes: int) -> None:
    db.execute(
        text(
            "UPDATE outings SET left_at = now() - interval '3 hours', "
            "expected_return_at = now() + make_interval(mins => :m) WHERE returned_at IS NULL"
        ),
        {"m": minutes},
    )
    db.commit()


def titles(push, value) -> list[str]:
    return [m.title for m in sent_to(push, value)]


def test_followers_see_the_due_back_time_and_a_moved_one(client, db, push, anna, friend):
    w = watching(client, friend)
    assert (w["due_back_at"], w["original_due_at"]) == (None, None)  # not out
    go_out(client, anna)
    due = at(client.get("/outings/current", headers=anna).json()["expected_return_at"])
    w = watching(client, friend)
    assert at(w["due_back_at"]) == due and w["original_due_at"] is None
    moved = late(client, anna, 30, "Private reason")
    w = watching(client, friend)
    assert at(w["due_back_at"]) == at(moved["expected_return_at"])
    assert at(w["original_due_at"]) == due
    assert "Private reason" not in str(w)  # the office's, not the followers'
    r = client.get(f"/sessions/{w['id']}", headers=friend)
    assert at(r.json()["due_back_at"]) == at(moved["expected_return_at"])
    client.post("/outings/current/return", headers=anna)
    assert watching(client, friend)["due_back_at"] is None


def test_followers_are_told_running_late_late_and_back(client, db, push, anna, friend):
    go_out(client, anna)
    due_in(db, -10)
    late(client, anna, 15)
    [m] = sent_to(push, FRIEND)
    assert m.title == "Anna: return time updated"
    assert m.body.startswith("Due ") and m.body.endswith(". The hostel office has been notified.")
    assert "(was " in m.body
    assert (m.url, m.channel, m.urgent) == (FOLLOW_URL, "share-status", False)
    # Every notice about Anna replaces the last one shown about her.
    assert m.tag.startswith("follow:") and m.ttl == 24 * 3600
    # 31 min past the new time: Anna's own alert, and her followers are told once.
    db.execute(
        text(
            "UPDATE outings SET expected_return_at = now() - interval '31 minutes', "
            "original_return_at = now() - interval '46 minutes'"
        )
    )
    db.commit()
    push.outbox.clear()
    run_sweep(client)
    assert titles(push, FRIEND) == ["Anna: return overdue"]
    run_sweep(client)
    assert titles(push, FRIEND) == ["Anna: return overdue"]
    [m] = sent_to(push, FRIEND)
    assert m.body.startswith("Due ") and m.body.endswith(". Lumiback has sent a check-in.")
    assert titles(push, ANNA) == ["Return overdue: 31 min"]
    r = client.post("/outings/current/return", headers=anna)
    assert r.status_code == 200, r.text
    assert titles(push, FRIEND) == ["Anna: return overdue", "Anna: returned"]
    back = sent_to(push, FRIEND)[-1]
    assert back.body.startswith("Back at the hostel at ") and back.tag == m.tag


def test_a_follower_cut_off_before_the_send_gets_nothing(client, db, push, mailer, anna, friend):
    go_out(client, anna)
    client.app.state.push = None  # queued, not sent yet
    late(client, anna, 30)
    db.execute(text("UPDATE share_viewers SET status = 'revoked', revoked_at = now()"))
    db.commit()
    deliver(client, push, mailer)
    assert sent_to(push, FRIEND) == [] and mail_to(mailer, "friend@geu.ac.in") == []
    [row] = [r for r in rows(db) if r.kind == "follower_running_late"]
    assert row.failed_at is not None and row.payload == {}


def test_followers_without_the_app_are_emailed_and_muted_phones_respected(
    client, db, push, mailer, anna, friend
):
    _, sam = signup(client, "sam@geu.ac.in", "Sam")  # no app
    befriend(client, anna, "sam@geu.ac.in", sam)
    share_with(client, anna, [client.get("/auth/me", headers=sam).json()["id"]])
    r = client.post(
        "/devices/push-token",
        json={"token": FRIEND, "platform": "android", "muted": ["share-status"]},
        headers=friend,
    )
    assert r.status_code == 204, r.text
    go_out(client, anna)
    late(client, anna, 30)
    assert sent_to(push, FRIEND) == []  # muted on that phone: their choice, no email either
    assert mail_to(mailer, "friend@geu.ac.in") == []
    [mail] = mail_to(mailer, "sam@geu.ac.in")
    assert "Anna" in mail.subject and "/share" in mail.body
    # The push got the v2 status title; the email keeps its plain-words heading (wave 5 changed
    # push wording only).
    assert mail.subject == "Lumiback: Anna will be back later"


def test_stopping_a_share_is_told_to_nobody_even_while_out(client, db, push, mailer, anna, friend):
    # Owner, 2026-11-09: stopping is the student's own choice, often to cut someone off.
    go_out(client, anna)
    push.outbox.clear()
    [share] = client.get("/sessions/mine", headers=anna).json()
    r = client.post(f"/sessions/{share['id']}/stop", headers=anna)
    assert r.status_code == 200, r.text
    run_sweep(client)
    assert sent_to(push, FRIEND) == [] and mail_to(mailer, "friend@geu.ac.in") == []
    assert [r.kind for r in rows(db) if r.kind.startswith("follower_")] == []


def end_shares(db, how: str) -> None:
    """End every live share the way the sweep would find it: time ran out, or quiet."""
    change = (
        "ends_at = now() - interval '1 minute'"
        if how == "expired"
        else "source = 'app', sharer_seen_at = now() - interval '1 hour'"
    )
    db.execute(
        text(
            f"UPDATE share_sessions SET {change}, created_at = now() - interval '2 hours' "
            "WHERE status = 'active'"
        )
    )
    db.commit()


def test_a_share_that_ends_on_its_own_while_out_tells_its_followers(
    client, db, push, mailer, anna, friend
):
    # Not out: a share running out is no news.
    end_shares(db, "expired")
    run_sweep(client)
    assert sent_to(push, FRIEND) == []
    friend_id = client.get("/auth/me", headers=friend).json()["id"]
    share_with(client, anna, [friend_id])
    go_out(client, anna)
    push.outbox.clear()
    end_shares(db, "expired")
    run_sweep(client)
    [m] = sent_to(push, FRIEND)
    assert m.title == "Anna's location sharing timed out"
    assert (m.url, m.channel) == (FOLLOW_URL, "share-status")
    # Only that it timed out (owner: "Timed out only"): not that she's out, nor when she's due.
    assert m.body == "You can't see their location until they share it again."
    # Never replaces a "return overdue" notice about her still on the phone.
    assert m.tag.startswith("follow-share:") and m.ttl == 24 * 3600
    assert mail_to(mailer, "friend@geu.ac.in") == []  # they have the app: pushed, not emailed
    run_sweep(client)
    assert len(sent_to(push, FRIEND)) == 1  # once
    # The phone going quiet ends a share too, and is told the same way.
    share_with(client, anna, [friend_id])
    push.outbox.clear()
    end_shares(db, "quiet")
    run_sweep(client)
    assert titles(push, FRIEND) == ["Anna's location sharing timed out"]
    assert [r.kind for r in rows(db)].count("follower_timed_out") == 2


def test_a_share_ending_on_its_own_is_no_news_to_someone_still_following(
    client, db, push, anna, friend
):
    friend_id = client.get("/auth/me", headers=friend).json()["id"]
    go_out(client, anna)
    longer = share_with(client, anna, [friend_id])
    db.execute(
        text("UPDATE share_sessions SET ends_at = now() + interval '2 hours' WHERE id = :id"),
        {"id": longer["id"]},
    )
    db.execute(
        text(
            "UPDATE share_sessions SET ends_at = now() - interval '1 minute', "
            "created_at = now() - interval '2 hours' WHERE id != :id AND status = 'active'"
        ),
        {"id": longer["id"]},
    )
    db.commit()
    push.outbox.clear()
    run_sweep(client)
    assert sent_to(push, FRIEND) == []


def test_a_revoked_viewer_is_not_told_the_share_timed_out(client, db, push, mailer, anna, friend):
    go_out(client, anna)
    db.execute(text("UPDATE share_viewers SET status = 'revoked', revoked_at = now()"))
    db.commit()
    end_shares(db, "expired")
    run_sweep(client)
    assert sent_to(push, FRIEND) == [] and mail_to(mailer, "friend@geu.ac.in") == []


def test_a_viewer_revoked_before_the_send_is_not_told_it_timed_out(
    client, db, push, mailer, anna, friend
):
    go_out(client, anna)
    client.app.state.push = None  # queued by the sweep, not sent yet
    end_shares(db, "expired")
    run_sweep(client)
    assert [r.kind for r in rows(db)].count("follower_timed_out") == 1
    db.execute(text("UPDATE share_viewers SET status = 'revoked', revoked_at = now()"))
    db.commit()
    deliver(client, push, mailer)
    assert sent_to(push, FRIEND) == [] and mail_to(mailer, "friend@geu.ac.in") == []


def test_check_outs_and_new_shares_are_capped_so_notices_cant_loop(
    client, db, push, anna, friend, clock
):
    """Audit run-8: each check-out/return and each share can notify followers or the office,
    so a script can't loop them. Far above a real evening; the hour passes and it's open."""
    for _ in range(20):
        go_out(client, anna)
        assert client.post("/outings/current/return", headers=anna).status_code == 200
    r = client.post("/outings", json={"destination": "Rajpur Road"}, headers=anna)
    assert r.status_code == 429, r.text
    friend_id = client.get("/auth/me", headers=friend).json()["id"]
    for _ in range(29):  # the fixture's own share was the first
        share_with(client, anna, [friend_id])
    r = client.post(
        "/sessions",
        json={"source": "manual", "duration_minutes": 60, "viewer_user_ids": [friend_id]},
        headers=anna,
    )
    assert r.status_code == 429, r.text
    clock.advance(3601)
    go_out(client, anna)
    share_with(client, anna, [friend_id])


def test_the_safe_return_contact_who_also_follows_is_not_told_twice(
    client, db, push, mailer, anna, friend
):
    r = client.patch("/profile", json={"emergency_email": "friend@geu.ac.in"}, headers=anna)
    assert r.status_code == 200, r.text
    r = client.post(
        "/outings", json={"destination": "Clock Tower", "safe_return": True}, headers=anna
    )
    assert r.status_code == 201, r.text
    assert r.json()["safe_return_session_id"]
    due_in(db, -31)
    run_sweep(client)
    client.post("/outings/current/return", headers=anna)
    kinds = [r.kind for r in rows(db)]
    assert "follower_late" not in kinds and "follower_back" not in kinds
    assert sent_to(push, FRIEND) == []
