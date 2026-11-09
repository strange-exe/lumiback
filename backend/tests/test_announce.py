"""Announce an update (owner 2026-11-08): a developer, and only a developer, sends one push to
every phone with the app on the "App updates" channel, audited, never emailed. The daily limit
was dropped on 2026-11-09 (owner: "No timeout in announcements, it's just better for dev").
Owner: "add an option on dev roles which allows them to send the notification of the released
update don't send it directly": nothing sends it on its own (no release, deploy,
start-up, sweep or script path), only the developer's own request.
"""

import pathlib

import pytest
from sqlalchemy import text

from tests import test_alerts as base
from tests.helpers import signup
from tests.test_alerts import ADMIN, ANNA, BINA, HEAD, WARDEN_A, WARDEN_B, run_sweep, token
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


def test_an_announcement_goes_to_every_phone(client, db, push, mailer, admin, office, anna, bina):
    dev = developer(client, db)
    status = client.get("/admin/announcements", headers=dev).json()
    assert (status["last_at"], status["next_at"], status["history"]) == (None, None, [])
    # A turned-off account's phone gets nothing.
    db.execute(text("UPDATE users SET deactivated_at = now() WHERE email = 'bina@geu.ac.in'"))
    db.commit()
    mailed = len(mailer.outbox)
    r = client.post("/admin/announcements", json=NOTE, headers=dev)
    assert r.status_code == 200, r.text  # the clients read this body; they drop a 202's
    assert r.json()["devices"] == 6 and r.json()["next_at"] is None
    [(tokens, m)] = updates(push)
    assert set(tokens) == {DEV, ANNA, ADMIN, HEAD, WARDEN_A, WARDEN_B}
    assert (m.title, m.body, m.kind, m.url, m.urgent) == (
        NOTE["title"],
        NOTE["body"],
        "app-update",
        None,
        False,
    )
    # Wave 5: one update notice at a time (a new one replaces the last one shown), the
    # Changelog and Update buttons, three days to arrive, no picture unless asked for.
    assert (m.tag, m.category, m.ttl, m.image) == ("lumiback-update", "app_update", 259200, None)
    assert len(mailer.outbox) == mailed  # never emailed
    # The audit row says what kind, to whom, and how many phones (a notice by default: what
    # 1.18 and 1.19 apps send, without a kind).
    assert db.execute(
        text("SELECT target FROM admin_audit WHERE action = 'announce:update'")
    ).scalars().all() == [f"{NOTE['title']} (notice, everyone, 6 devices)"]
    status = client.get("/admin/announcements", headers=dev).json()
    # next_at stays in the answer, always null: 1.18.x apps read it to show the form.
    assert status["last_at"] and status["next_at"] is None
    [sent] = status["history"]
    assert sent["at"] == status["last_at"]
    assert {k: v for k, v in sent.items() if k != "at"} == {
        "by": "Dev",
        "kind": "notice",
        "title": NOTE["title"],
        "audience": "everyone",
        "devices": 6,
        "image": None,
    }


BANNER_DIR = BACKEND.parent / "apps" / "web" / "public" / "app" / "banners"


def test_the_banner_allowlist_is_the_website_s_banner_files():
    """A banner is only ever one of these names, each a file the website serves."""
    from app.api.admin import BANNERS

    assert sorted(BANNERS) == sorted(p.stem for p in BANNER_DIR.glob("*.png"))
    assert len(BANNERS) >= 1


def test_a_feature_carries_a_banner_from_the_website(client, db, push, settings, admin, anna):
    dev = developer(client, db)
    status = client.get("/admin/announcements", headers=dev).json()
    # The choices, with where each is served (the configured website, never the request's).
    assert status["banners"] == [
        {"name": n, "url": f"{settings.web_url}/app/banners/{n}.png"}
        for n in sorted(p.stem for p in BANNER_DIR.glob("*.png"))
    ]
    body = {
        "title": "Now live: Running late",
        "body": "Shift your due-back time once per outing. The office is notified instantly.",
        "kind": "feature",
        "image": "lantern",
    }
    r = client.post("/admin/announcements", json=body, headers=dev)
    assert r.status_code == 200, r.text
    [(_, m)] = updates(push)
    assert m.image == f"{settings.web_url}/app/banners/lantern.png"
    [sent] = client.get("/admin/announcements", headers=dev).json()["history"]
    assert (sent["kind"], sent["image"]) == ("feature", "lantern")


@pytest.mark.parametrize(
    "extra",
    [
        {"kind": "feature", "image": "https://example.com/x.png"},  # never a free URL
        {"kind": "feature", "image": "../icons/icon-512"},
        {"kind": "feature", "image": "LANTERN"},
        {"kind": "fix", "image": "lantern"},  # pictures are for feature launches only
        {"kind": "maintenance", "image": "lantern"},
        {"kind": "release"},
        {"audience": []},
        {"audience": ["student", "nobody"]},
        {"audience": "students"},
        {"audience": ["student", "student"]},
        {"subtitle": "Release 1.20"},  # Android drops it (spike 2026-11-09): never accepted
    ],
)
def test_kind_banner_and_audience_are_checked(client, db, push, extra):
    dev = developer(client, db)
    r = client.post("/admin/announcements", json={**NOTE, **extra}, headers=dev)
    assert r.status_code == 422, (extra, r.text)
    assert updates(push) == []


def test_a_well_formed_banner_name_not_on_the_list_is_refused(client, db, push):
    """The name passes the schema's pattern, so only the allowlist (api/admin.py BANNERS)
    stops it."""
    dev = developer(client, db)
    body = {**NOTE, "kind": "feature", "image": "sunset"}
    r = client.post("/admin/announcements", json=body, headers=dev)
    assert (r.status_code, r.json()["detail"]) == (422, "Unknown banner")
    assert updates(push) == []


def test_an_announcement_can_go_to_chosen_roles(client, db, push, admin, office, anna, bina):
    dev = developer(client, db)
    body = {**NOTE, "kind": "notice", "audience": ["warden", "head_warden"]}
    r = client.post("/admin/announcements", json=body, headers=dev)
    assert (r.status_code, r.json()["devices"]) == (200, 3)
    [(tokens, _)] = updates(push)
    assert set(tokens) == {HEAD, WARDEN_A, WARDEN_B}
    target = db.execute(
        text("SELECT target FROM admin_audit WHERE action = 'announce:update'")
    ).scalar_one()
    assert target == f"{NOTE['title']} (notice, head_warden + warden, 3 devices)"
    [sent] = client.get("/admin/announcements", headers=dev).json()["history"]
    assert sent["audience"] == ["head_warden", "warden"]
    # Students only.
    r = client.post("/admin/announcements", json={**NOTE, "audience": ["student"]}, headers=dev)
    assert r.json()["devices"] == 2
    assert set(updates(push)[-1][0]) == {ANNA, BINA}


def test_the_history_is_the_last_20_newest_first(client, db, push, monkeypatch):
    monkeypatch.setattr("app.api.admin.HISTORY", 3)
    dev = developer(client, db)
    for n in range(4):
        note = {"title": f"Patch: fix {n}", "body": "x", "kind": "fix"}
        assert client.post("/admin/announcements", json=note, headers=dev).status_code == 200
    history = client.get("/admin/announcements", headers=dev).json()["history"]
    assert [h["title"] for h in history] == ["Patch: fix 3", "Patch: fix 2", "Patch: fix 1"]


def test_the_real_history_length_is_20():
    from app.api import admin

    assert admin.HISTORY == 20


def test_two_announcements_in_a_row_both_send(client, db, push, admin, office, anna):
    """Owner, 2026-11-09: "No timeout in announcements, it's just better for dev"."""
    dev = developer(client, db)
    second = {"title": "Lumiback 1.18.1", "body": "A fix for the announcement form."}
    for note in (NOTE, second):
        r = client.post("/admin/announcements", json=note, headers=dev)
        assert r.status_code == 200, r.text
        assert r.json()["next_at"] is None
    assert [m.title for _, m in updates(push)] == [NOTE["title"], second["title"]]
    assert db.execute(
        text("SELECT target FROM admin_audit WHERE action = 'announce:update' ORDER BY at, id")
    ).scalars().all() == [
        f"{NOTE['title']} (notice, everyone, 6 devices)",
        f"{second['title']} (notice, everyone, 6 devices)",
    ]
    assert client.get("/admin/announcements", headers=dev).json()["next_at"] is None


def test_a_server_without_push_refuses_and_logs_nothing(client, db, push):
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
