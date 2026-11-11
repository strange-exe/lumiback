"""A closing share tab says it is leaving: the share ends after a short grace unless it stays.

The tab's last word (the stop beacon on `pagehide`) can be lost on a slow device: the browser
tears the page down before the handler runs. The leaving mark is sent earlier, from
`beforeunload`, which the browser waits for. These tests cover the backend half.
"""

import asyncio
import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.api import sessions as sessions_api
from app.email import MemoryMailer
from app.jobs.expiry import sweep
from app.main import create_app
from app.realtime import AccessChanged
from app.security.rate_limit import Limit
from tests.helpers import signup

FIX = {"lat": 30.3, "lng": 78.0, "accuracy_m": 5}
LEAVING = text("SELECT leaving_at FROM share_sessions WHERE id = :s")
STATE = text("SELECT status, ended_reason FROM share_sessions WHERE id = :s")
LOCATIONS = text("SELECT count(*) FROM locations WHERE session_id = :s")


def tab_live(client, sharer, source="tab_live"):
    r = client.post("/sessions", json={"source": source, "duration_minutes": 60}, headers=sharer)
    assert r.status_code == 201, r.text
    s = r.json()
    fix = {**FIX, "recorded_at": datetime.now(UTC).isoformat()}
    assert client.put(f"/sessions/{s['id']}/location", json=fix, headers=sharer).status_code == 204
    return s


def left_ago(db, session_id, seconds):
    """The tab said it was leaving `seconds` ago."""
    db.execute(
        text(
            "UPDATE share_sessions SET leaving_at = now() - make_interval(secs => :n) WHERE id = :s"
        ),
        {"s": session_id, "n": seconds},
    )
    db.commit()


def run_sweep(client):
    return client.portal.call(sweep, client.app.state.sessionmaker, client.app.state.hub)


def test_leaving_marks_a_tab_share_and_staying_clears_it(client, db):
    _, riya = signup(client, "riya@example.com", "Riya")
    s = tab_live(client, riya)

    assert client.post(f"/sessions/{s['id']}/leaving", headers=riya).status_code == 204
    assert db.execute(LEAVING, {"s": s["id"]}).scalar_one() is not None
    assert client.delete(f"/sessions/{s['id']}/leaving", headers=riya).status_code == 204
    assert db.execute(LEAVING, {"s": s["id"]}).scalar_one() is None


def test_only_the_sharer_can_say_their_tab_is_leaving(client, db):
    _, riya = signup(client, "riya@example.com", "Riya")
    _, arjun = signup(client, "arjun@example.com", "Arjun")
    s = tab_live(client, riya)

    assert client.post(f"/sessions/{s['id']}/leaving", headers=arjun).status_code == 404
    assert client.delete(f"/sessions/{s['id']}/leaving", headers=arjun).status_code == 404
    assert db.execute(LEAVING, {"s": s["id"]}).scalar_one() is None


def test_an_app_share_is_never_marked(client, db):
    """Only a tab share belongs to a tab; an app share reports from a background service."""
    _, riya = signup(client, "riya@example.com", "Riya")
    s = tab_live(client, riya, source="app")

    assert client.post(f"/sessions/{s['id']}/leaving", headers=riya).status_code == 204
    assert db.execute(LEAVING, {"s": s["id"]}).scalar_one() is None


def test_the_sweep_ends_a_share_whose_tab_left_and_never_came_back(client, db):
    _, riya = signup(client, "riya@example.com", "Riya")
    gone = tab_live(client, riya)
    deciding = tab_live(client, riya)
    left_ago(db, gone["id"], 31)
    left_ago(db, deciding["id"], 10)  # still inside the grace: the dialog may be open

    seen: list = []

    async def spy(event):
        seen.append(event)

    client.app.state.hub.subscribe(uuid.UUID(gone["id"]), spy)
    assert run_sweep(client).closed_tabs == [uuid.UUID(gone["id"])]

    assert tuple(db.execute(STATE, {"s": gone["id"]}).one()) == ("ended", "tab_closed")
    assert db.execute(LOCATIONS, {"s": gone["id"]}).scalar_one() == 0
    assert seen == [AccessChanged(uuid.UUID(gone["id"]))]
    assert tuple(db.execute(STATE, {"s": deciding["id"]}).one()) == ("active", None)


def test_a_tab_that_stayed_is_not_ended_by_the_sweep(client, db):
    _, riya = signup(client, "riya@example.com", "Riya")
    s = tab_live(client, riya)
    left_ago(db, s["id"], 31)
    assert client.delete(f"/sessions/{s['id']}/leaving", headers=riya).status_code == 204

    assert run_sweep(client).closed_tabs == []
    assert tuple(db.execute(STATE, {"s": s["id"]}).one()) == ("active", None)


def test_leaving_an_ended_share_changes_nothing(client, db):
    _, riya = signup(client, "riya@example.com", "Riya")
    s = tab_live(client, riya)
    assert client.post(f"/sessions/{s['id']}/stop", headers=riya).status_code == 200

    assert client.post(f"/sessions/{s['id']}/leaving", headers=riya).status_code == 204
    assert db.execute(LEAVING, {"s": s["id"]}).scalar_one() is None


@pytest.fixture
def quick(settings, clean_db):
    """An API whose leave grace is short enough to wait for."""
    app = create_app(settings.model_copy(update={"tab_leave_grace_seconds": 0.3}), start_jobs=False)
    app.state.mailer = MemoryMailer()  # signup reads its code from here
    with TestClient(app, backend_options={"loop_factory": asyncio.SelectorEventLoop}) as c:
        yield c


def wait(client, seconds):
    client.portal.call(asyncio.sleep, seconds)


def test_the_api_ends_a_left_share_after_the_grace_without_the_sweep(quick, db):
    _, riya = signup(quick, "riya@example.com", "Riya")
    s = tab_live(quick, riya)
    seen: list = []

    async def spy(event):
        seen.append(event)

    quick.app.state.hub.subscribe(uuid.UUID(s["id"]), spy)
    assert quick.post(f"/sessions/{s['id']}/leaving", headers=riya).status_code == 204
    assert tuple(db.execute(STATE, {"s": s["id"]}).one()) == ("active", None)

    wait(quick, 1.0)
    assert tuple(db.execute(STATE, {"s": s["id"]}).one()) == ("ended", "tab_closed")
    assert db.execute(LOCATIONS, {"s": s["id"]}).scalar_one() == 0
    assert seen == [AccessChanged(uuid.UUID(s["id"]))]


def test_staying_within_the_grace_keeps_the_share_running(quick, db):
    _, riya = signup(quick, "riya@example.com", "Riya")
    s = tab_live(quick, riya)
    assert quick.post(f"/sessions/{s['id']}/leaving", headers=riya).status_code == 204
    assert quick.delete(f"/sessions/{s['id']}/leaving", headers=riya).status_code == 204

    wait(quick, 1.0)
    assert tuple(db.execute(STATE, {"s": s["id"]}).one()) == ("active", None)


def test_a_share_has_one_leave_timer_however_often_it_leaves(quick, db):
    """Each leave replaces the share's timer, so repeated beacons don't pile timers up."""
    _, riya = signup(quick, "riya@example.com", "Riya")
    s = tab_live(quick, riya)
    other = tab_live(quick, riya)
    for _ in range(5):
        assert quick.post(f"/sessions/{s['id']}/leaving", headers=riya).status_code == 204
    assert quick.post(f"/sessions/{other['id']}/leaving", headers=riya).status_code == 204
    assert len(quick.app.state.leave_timers) == 2
    wait(quick, 1.0)
    assert len(quick.app.state.leave_timers) == 0  # done timers are dropped
    assert tuple(db.execute(STATE, {"s": s["id"]}).one()) == ("ended", "tab_closed")


def test_leaving_is_limited_per_student_across_their_shares(client, db, monkeypatch):
    monkeypatch.setattr(sessions_api, "LEAVES_PER_SHARER", Limit(max_hits=2, window_seconds=60))
    _, riya = signup(client, "riya@example.com", "Riya")
    shares = [tab_live(client, riya) for _ in range(3)]
    for s in shares[:2]:
        assert client.post(f"/sessions/{s['id']}/leaving", headers=riya).status_code == 204
    assert client.post(f"/sessions/{shares[2]['id']}/leaving", headers=riya).status_code == 429
    assert db.execute(LEAVING, {"s": shares[2]["id"]}).scalar_one() is None


def test_staying_without_a_mark_writes_nothing(client, db):
    _, riya = signup(client, "riya@example.com", "Riya")
    s = tab_live(client, riya)
    version = text("SELECT xmin::text FROM share_sessions WHERE id = :s")
    before = db.execute(version, {"s": s["id"]}).scalar_one()
    db.commit()
    assert client.delete(f"/sessions/{s['id']}/leaving", headers=riya).status_code == 204
    assert db.execute(version, {"s": s["id"]}).scalar_one() == before  # the row was not rewritten


def test_only_the_latest_leaving_mark_counts(quick, db):
    """Leave, stay, leave again: the first timer must not end the share early; the last does."""
    _, riya = signup(quick, "riya@example.com", "Riya")
    s = tab_live(quick, riya)
    assert quick.post(f"/sessions/{s['id']}/leaving", headers=riya).status_code == 204
    assert quick.delete(f"/sessions/{s['id']}/leaving", headers=riya).status_code == 204
    wait(quick, 0.2)
    assert quick.post(f"/sessions/{s['id']}/leaving", headers=riya).status_code == 204
    wait(quick, 0.15)  # the first mark's timer has fired by now
    assert tuple(db.execute(STATE, {"s": s["id"]}).one()) == ("active", None)
    wait(quick, 0.8)
    assert tuple(db.execute(STATE, {"s": s["id"]}).one()) == ("ended", "tab_closed")
