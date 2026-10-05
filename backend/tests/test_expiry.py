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
