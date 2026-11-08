"""Announce an update (owner 2026-11-08): a developer, and only a developer, sends one push to
every phone with the app on the "App updates" channel, at most once a day, audited, never
emailed. Owner: "add an option on dev roles which allows them to send the notification of the
released update don't send it directly": nothing sends it on its own (no release, deploy,
start-up, sweep or script path), only the developer's own request.
"""

import pathlib

from sqlalchemy import text

from tests import test_alerts as base
from tests.helpers import signup
from tests.test_alerts import ADMIN, ANNA, HEAD, WARDEN_A, WARDEN_B, run_sweep, token
from tests.test_view_as import as_, make_developer

# The wave 2 fixtures (two hostels, their office with phones, Anna and Bina with phones).
many_sign_ups = base.many_sign_ups
push, mailer, admin = base.push, base.mailer, base.admin
hostels, office, anna, bina = base.hostels, base.office, base.anna, base.bina

DEV = "ExponentPushToken[developerPh01]"
NOTE = {"title": "Lumiback 1.18.0", "body": "Tell the office you're running late."}
BACKEND = pathlib.Path(__file__).resolve().parents[1]


def developer(client, db):
    _, headers = signup(client, "dev@geu.ac.in", "Dev")
    make_developer(db, "dev@geu.ac.in")
    token(client, headers, DEV)
    return headers


def updates(push) -> list:
    return [(tokens, m) for tokens, m in push.outbox if m.channel == "app-updates"]


def test_only_a_developer_may_announce(client, db, push, admin, office, anna):
    for headers in (admin, office["head"], office["A"], anna):
        assert client.get("/admin/announcements", headers=headers).status_code == 403
        r = client.post("/admin/announcements", json=NOTE, headers=headers)
        assert (r.status_code, r.json()["detail"]) == (403, "Developers only")
    assert client.post("/admin/announcements", json=NOTE).status_code == 401
    dev = developer(client, db)
    # Viewing the app as another role is read-only, as everywhere.
    r = client.post("/admin/announcements", json=NOTE, headers=as_(dev, "admin"))
    assert r.status_code == 403
    assert updates(push) == []


def test_an_announcement_goes_to_every_phone_once_a_day(
    client, db, push, mailer, admin, office, anna, bina
):
    dev = developer(client, db)
    assert client.get("/admin/announcements", headers=dev).json() == {
        "last_at": None,
        "next_at": None,
    }
    # A turned-off account's phone gets nothing.
    db.execute(text("UPDATE users SET deactivated_at = now() WHERE email = 'bina@geu.ac.in'"))
    db.commit()
    mailed = len(mailer.outbox)
    r = client.post("/admin/announcements", json=NOTE, headers=dev)
    assert r.status_code == 200, r.text  # the clients read this body; they drop a 202's
    assert r.json()["devices"] == 6 and r.json()["next_at"]
    [(tokens, m)] = updates(push)
    assert set(tokens) == {DEV, ANNA, ADMIN, HEAD, WARDEN_A, WARDEN_B}
    assert (m.title, m.body, m.kind, m.url, m.urgent) == (
        NOTE["title"],
        NOTE["body"],
        "app-update",
        None,
        False,
    )
    assert len(mailer.outbox) == mailed  # never emailed
    assert db.execute(
        text("SELECT target FROM admin_audit WHERE action = 'announce:update'")
    ).scalars().all() == [NOTE["title"]]
    status = client.get("/admin/announcements", headers=dev).json()
    assert status["last_at"] and status["next_at"]

    r = client.post("/admin/announcements", json=NOTE, headers=dev)
    assert r.status_code == 409
    assert r.json()["detail"].startswith("An update was already announced in the last 24 hours.")
    assert len(updates(push)) == 1
    db.execute(text("UPDATE admin_audit SET at = at - interval '25 hours'"))
    db.commit()
    assert client.post("/admin/announcements", json=NOTE, headers=dev).status_code == 200
    assert len(updates(push)) == 2


def test_a_server_without_push_refuses_and_keeps_the_days_announcement(client, db, push):
    dev = developer(client, db)
    client.app.state.push = None
    r = client.post("/admin/announcements", json=NOTE, headers=dev)
    assert r.status_code == 503 and "nothing was sent" in r.json()["detail"]
    assert client.get("/admin/announcements", headers=dev).json()["last_at"] is None
    client.app.state.push = push
    assert client.post("/admin/announcements", json=NOTE, headers=dev).status_code == 200


def test_the_announcement_is_short_plain_text(client, db, push):
    dev = developer(client, db)
    for body in (
        {"title": "", "body": "x"},
        {"title": "x" * 51, "body": "x"},
        {"title": "x", "body": "x" * 141},
        {"title": "x", "body": "two\nlines"},
        {"title": "x" + chr(0x200B), "body": "x"},
        {"title": "x", "body": "x", "url": "https://example.com"},
    ):
        r = client.post("/admin/announcements", json=body, headers=dev)
        assert r.status_code == 422, (body, r.text)
    assert updates(push) == []


def test_nothing_announces_an_update_on_its_own(client, db, push, admin, anna):
    developer(client, db)
    # Start-up (the client fixture ran it) and the sweep send nothing.
    run_sweep(client)
    assert updates(push) == []
    # The only code that sends one is the developer's request; no script or job calls it.
    callers = sorted(
        p.relative_to(BACKEND).as_posix()
        for folder in ("app", "scripts", "migrations")
        for p in (BACKEND / folder).rglob("*.py")
        if "push_everyone" in p.read_text(encoding="utf-8")
    )
    assert callers == ["app/api/admin.py", "app/push.py"]
