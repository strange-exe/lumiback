"""Expiry sweep: persists expiry, deletes locations, disconnects idle viewers, tidies up."""

import asyncio
import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from starlette.websockets import WebSocketDisconnect

from app.jobs.expiry import sweep
from app.main import create_app
from app.realtime import AccessChanged
from tests.helpers import befriend, share_with, signup

EXPIRE = text(
    "UPDATE share_sessions SET created_at = now() - interval '2 hours', "
    "ends_at = now() - interval '1 second' WHERE id = :s"
)


def run_sweep(client):
    return client.portal.call(sweep, client.app.state.sessionmaker, client.app.state.hub)


def setup_share(client):
    _, riya = signup(client, "riya@example.com", "Riya")
    arjun_user, arjun = signup(client, "arjun@example.com", "Arjun")
    befriend(client, riya, "arjun@example.com", arjun)
    s = share_with(client, riya, [arjun_user["id"]])
    fix = {"lat": 30.3, "lng": 78.0, "accuracy_m": 5, "recorded_at": datetime.now(UTC).isoformat()}
    client.put(f"/sessions/{s['id']}/location", json=fix, headers=riya)
    return riya, arjun, s


def test_sweep_ends_expired_sessions_and_deletes_their_location(client, db):
    riya, _, expired = setup_share(client)
    live = share_with(client, riya, [_viewer_user(client, riya)])
    db.execute(EXPIRE, {"s": expired["id"]})
    db.commit()

    seen: list = []

    async def spy(event):
        seen.append(event)

    client.app.state.hub.subscribe(uuid.UUID(expired["id"]), spy)
    result = run_sweep(client)

    assert result.expired_sessions == [uuid.UUID(expired["id"])]
    row = db.execute(
        text("SELECT status, ended_reason, ended_at IS NOT NULL FROM share_sessions WHERE id = :s"),
        {"s": expired["id"]},
    ).one()
    assert tuple(row) == ("ended", "expired", True)
    assert db.execute(text("SELECT count(*) FROM locations")).scalar_one() == 0
    assert seen == [AccessChanged(uuid.UUID(expired["id"]))]

    live_status = client.get(f"/sessions/{live['id']}", headers=riya).json()["status"]
    assert live_status == "active"
    assert run_sweep(client).expired_sessions == []  # idempotent


def _viewer_user(client, riya):
    return client.get("/contacts", headers=riya).json()["outgoing"][0]["person"]["id"]


def test_sweep_disconnects_idle_websocket_viewers(client, db):
    """The sharer's phone went quiet: no location event will ever arrive, the sweep still
    closes the viewer's stream."""
    _, arjun, s = setup_share(client)
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "auth", "token": arjun["Authorization"].removeprefix("Bearer ")})
        assert ws.receive_json()["type"] == "ready"
        ws.send_json({"type": "subscribe", "session_id": s["id"]})
        assert ws.receive_json()["type"] == "subscribed"

        db.execute(EXPIRE, {"s": s["id"]})
        db.commit()
        run_sweep(client)

        assert ws.receive_json() == {"type": "ended", "session_id": s["id"], "reason": "expired"}
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == 4403


def test_sweep_removes_long_dead_codes_and_refresh_tokens(client, db):
    riya, _, s = setup_share(client)
    client.post(f"/sessions/{s['id']}/codes", headers=riya)
    db.execute(
        text(
            "UPDATE share_codes SET created_at = now() - interval '3 days', "
            "expires_at = now() - interval '2 days'"
        )
    )
    db.execute(text("UPDATE refresh_tokens SET expires_at = now() - interval '8 days'"))
    db.commit()

    result = run_sweep(client)
    assert result.deleted_codes == 1
    assert result.deleted_refresh_tokens >= 1
    assert db.execute(text("SELECT count(*) FROM share_codes")).scalar_one() == 0


def test_app_runs_the_sweeper_in_the_background_and_stops_it(settings, clean_db):
    app = create_app(settings)
    with TestClient(app, backend_options={"loop_factory": asyncio.SelectorEventLoop}):
        task = app.state.sweeper
        assert task is not None and not task.done()
    assert task.cancelled() or task.done()


def tab_live(client, sharer):
    r = client.post(
        "/sessions", json={"source": "tab_live", "duration_minutes": 60}, headers=sharer
    )
    assert r.status_code == 201, r.text
    return r.json()


def quiet_for(db, session_id, minutes):
    """The sharer's tab last checked in `minutes` ago (and the session started before that)."""
    db.execute(
        text(
            "UPDATE share_sessions SET created_at = now() - make_interval(mins => :m + 1), "
            "sharer_seen_at = now() - make_interval(mins => :m) WHERE id = :s"
        ),
        {"s": session_id, "m": minutes},
    )
    db.commit()


def test_location_updates_record_when_the_sharer_last_checked_in(client, db):
    _, riya = signup(client, "riya@example.com", "Riya")
    s = tab_live(client, riya)
    seen = text("SELECT sharer_seen_at FROM share_sessions WHERE id = :s")
    assert db.execute(seen, {"s": s["id"]}).scalar_one() is None

    old_fix = {"lat": 30.3, "lng": 78.0, "accuracy_m": 5, "recorded_at": "2026-01-01T00:00:00Z"}
    assert (
        client.put(f"/sessions/{s['id']}/location", json=old_fix, headers=riya).status_code == 204
    )
    first = db.execute(seen, {"s": s["id"]}).scalar_one()
    # Server time, not the device's recorded_at: a wrong phone clock cannot keep a share alive.
    assert first is not None and abs((first - datetime.now(UTC)).total_seconds()) < 60


def test_sweep_ends_tab_live_sessions_whose_tab_went_quiet(client, db):
    riya, _, manual = setup_share(client)
    quiet = tab_live(client, riya)
    fresh = tab_live(client, riya)
    client.put(
        f"/sessions/{quiet['id']}/location",
        json={
            "lat": 30.3,
            "lng": 78.0,
            "accuracy_m": 5,
            "recorded_at": datetime.now(UTC).isoformat(),
        },
        headers=riya,
    )
    quiet_for(db, quiet["id"], 6)
    quiet_for(db, fresh["id"], 2)
    quiet_for(db, manual["id"], 30)  # manual shares last for their chosen duration regardless

    seen: list = []

    async def spy(event):
        seen.append(event)

    client.app.state.hub.subscribe(uuid.UUID(quiet["id"]), spy)
    result = run_sweep(client)

    assert result.closed_tabs == [uuid.UUID(quiet["id"])]
    assert result.expired_sessions == []
    row = db.execute(
        text("SELECT status, ended_reason FROM share_sessions WHERE id = :s"), {"s": quiet["id"]}
    ).one()
    assert tuple(row) == ("ended", "tab_closed")
    locations = text("SELECT count(*) FROM locations WHERE session_id = :s")
    assert db.execute(locations, {"s": quiet["id"]}).scalar_one() == 0
    assert seen == [AccessChanged(uuid.UUID(quiet["id"]))]
    for still_live in (fresh, manual):
        assert (
            client.get(f"/sessions/{still_live['id']}", headers=riya).json()["status"] == "active"
        )


def test_tab_that_never_checked_in_ends_after_the_idle_window(client, db):
    """Opened the share, never granted location permission, walked away."""
    _, riya = signup(client, "riya@example.com", "Riya")
    s = tab_live(client, riya)
    db.execute(
        text("UPDATE share_sessions SET created_at = now() - interval '6 minutes' WHERE id = :s"),
        {"s": s["id"]},
    )
    db.commit()
    assert run_sweep(client).closed_tabs == [uuid.UUID(s["id"])]


def test_app_shares_survive_short_silences_but_end_when_the_phone_goes_quiet(client, db):
    """A locked phone may batch updates; only 15 minutes of silence ends an app share."""
    _, riya = signup(client, "riya@example.com", "Riya")
    sleepy = client.post("/sessions", json={"source": "app", "duration_minutes": 120}, headers=riya)
    gone = client.post("/sessions", json={"source": "app", "duration_minutes": 120}, headers=riya)
    assert sleepy.status_code == gone.status_code == 201
    quiet_for(db, sleepy.json()["id"], 8)  # would end a tab share, not an app share
    quiet_for(db, gone.json()["id"], 16)

    result = run_sweep(client)
    assert result.closed_tabs == [uuid.UUID(gone.json()["id"])]
    row = db.execute(
        text("SELECT ended_reason FROM share_sessions WHERE id = :s"), {"s": gone.json()["id"]}
    ).scalar_one()
    assert row == "device_quiet"
    still = client.get(f"/sessions/{sleepy.json()['id']}", headers=riya).json()
    assert still["status"] == "active"
    assert still["ends_when"] == "duration"


def test_app_shares_take_viewers_by_code_only_and_last_at_most_8_hours(client):
    _, riya = signup(client, "riya@example.com", "Riya")
    too_long = client.post(
        "/sessions", json={"source": "app", "duration_minutes": 481}, headers=riya
    )
    assert too_long.status_code == 422
    by_id = client.post(
        "/sessions",
        json={"source": "app", "viewer_user_ids": [str(uuid.uuid4())]},
        headers=riya,
    )
    assert by_id.status_code == 422
