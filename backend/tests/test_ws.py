"""WebSocket: auth in first message, Origin check, per-message authorization (A3, A4, A11)."""

import time
import uuid
from contextlib import ExitStack, suppress
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text
from starlette.websockets import WebSocketDisconnect

from app.api import ws as ws_module
from app.realtime import LocationUpdated
from app.security.tokens import ACCESS_TTL, create_access_token
from tests.conftest import FAKE_SECRET
from tests.helpers import befriend, login, share_with, signup


def fix(lat=30.3165):
    return {
        "lat": lat,
        "lng": 78.03,
        "accuracy_m": 10,
        "recorded_at": datetime.now(UTC).isoformat(),
    }


def bearer(headers: dict) -> str:
    return headers["Authorization"].removeprefix("Bearer ")


@pytest.fixture
def connect(client):
    """Open authenticated sockets; every socket is properly exited at teardown."""
    stack = ExitStack()

    def _connect(token: str | None = None, guest: str | None = None, **kw):
        ws = stack.enter_context(client.websocket_connect("/ws", **kw))
        ws.send_json(
            {"type": "auth", "token": token} if token else {"type": "auth", "guest_token": guest}
        )
        assert ws.receive_json() == {"type": "ready"}
        return ws

    yield _connect
    with suppress(Exception):
        stack.close()


def closed_with(ws) -> int:
    with pytest.raises(WebSocketDisconnect) as exc:
        while True:
            ws.receive_json()
    return exc.value.code


@pytest.fixture
def shared(client):
    _, riya = signup(client, "riya@example.com", "Riya")
    arjun_user, arjun = signup(client, "arjun@example.com", "Arjun")
    _, mallory = signup(client, "mallory@example.com", "Mallory")
    befriend(client, riya, "arjun@example.com", arjun)
    s = share_with(client, riya, [arjun_user["id"]])
    client.put(f"/sessions/{s['id']}/location", json=fix(), headers=riya)
    return {"riya": riya, "arjun": arjun, "mallory": mallory, "s": s, "id": s["id"]}


def subscribe(ws, session_id):
    ws.send_json({"type": "subscribe", "session_id": session_id})
    return ws.receive_json()


# ---------- handshake & auth ----------


def test_first_message_must_authenticate(client, shared):
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "subscribe", "session_id": shared["id"]})
        assert closed_with(ws) == 4401


def test_invalid_token_rejected(client):
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "auth", "token": "not-a-jwt"})
        assert closed_with(ws) == 4401


def test_silent_client_is_closed_after_timeout(client, monkeypatch):
    monkeypatch.setattr(ws_module, "AUTH_TIMEOUT", 0.2)
    with client.websocket_connect("/ws") as ws:
        assert closed_with(ws) == 4401


def test_foreign_origin_is_rejected_at_handshake(client):
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/ws", headers={"origin": "https://evil.example"}):
            pass
    assert exc.value.code == 1008


def test_allowed_origin_and_native_apps_connect(connect, shared):
    token = bearer(shared["arjun"])
    for headers in ({"origin": "http://localhost:3000"}, {}):
        ws = connect(token, headers=headers)
        ws.close()


# ---------- streaming ----------


def test_viewer_gets_snapshot_then_live_updates_and_is_logged(connect, client, shared):
    """A11 (WS): a subscription is logged once."""
    ws = connect(bearer(shared["arjun"]))
    first = subscribe(ws, shared["id"])
    assert first["type"] == "subscribed"
    assert first["location"]["lat"] == pytest.approx(30.3165)

    client.put(f"/sessions/{shared['id']}/location", json=fix(lat=30.5), headers=shared["riya"])
    update = ws.receive_json()
    assert update["type"] == "location" and update["location"]["lat"] == 30.5

    log = client.get(f"/sessions/{shared['id']}/access-log", headers=shared["riya"]).json()
    assert [(e["viewer_name"], e["channel"]) for e in log] == [("Arjun", "ws")]
    ws.close()


def test_stranger_cannot_subscribe(connect, shared):
    ws = connect(bearer(shared["mallory"]))
    assert subscribe(ws, shared["id"])["type"] == "error"
    assert closed_with(ws) == 4404
    ws = connect(bearer(shared["mallory"]))
    assert subscribe(ws, str(uuid.uuid4()))["type"] == "error"


# ---------- A3: revocation and stop cut the stream ----------


def test_revoked_viewer_is_told_and_disconnected_within_2s(connect, client, shared):
    """A3 + the stop-to-access-loss metric."""
    ws = connect(bearer(shared["arjun"]))
    subscribe(ws, shared["id"])
    viewer_id = shared["s"]["viewers"][0]["id"]

    started = time.perf_counter()
    client.post(f"/sessions/{shared['id']}/viewers/{viewer_id}/revoke", headers=shared["riya"])
    ended = ws.receive_json()
    elapsed = time.perf_counter() - started

    assert ended == {"type": "ended", "session_id": shared["id"], "reason": "revoked"}
    assert closed_with(ws) == 4403
    assert elapsed < 2.0, f"access loss took {elapsed:.3f}s"
    assert (
        client.get(f"/sessions/{shared['id']}/location", headers=shared["arjun"]).status_code == 403
    )


def test_stop_ends_every_viewer_stream(connect, client, shared):
    ws = connect(bearer(shared["arjun"]))
    subscribe(ws, shared["id"])
    client.post(f"/sessions/{shared['id']}/stop", headers=shared["riya"])
    assert ws.receive_json()["reason"] == "stopped_by_sharer"
    assert closed_with(ws) == 4403


def test_authorization_is_rechecked_on_every_message_not_cached(connect, client, shared, db):
    """Revoke straight in the database (no hub event). The next update must not be delivered."""
    ws = connect(bearer(shared["arjun"]))
    subscribe(ws, shared["id"])
    db.execute(text("UPDATE share_viewers SET status = 'revoked', revoked_at = now()"))
    db.commit()

    client.put(f"/sessions/{shared['id']}/location", json=fix(lat=31.0), headers=shared["riya"])
    message = ws.receive_json()
    assert message["type"] == "ended"
    assert "location" not in message
    assert closed_with(ws) == 4403


def test_expired_session_closes_on_the_next_event(connect, client, shared, db):
    """A4 (WS): expiry needs no job; any event triggers the re-check."""
    ws = connect(bearer(shared["arjun"]))
    subscribe(ws, shared["id"])
    db.execute(
        text(
            "UPDATE share_sessions SET created_at = now() - interval '2 hours', "
            "ends_at = now() - interval '1 second'"
        )
    )
    db.commit()
    client.portal.call(client.app.state.hub.publish, LocationUpdated(uuid.UUID(shared["id"])))
    assert ws.receive_json() == {"type": "ended", "session_id": shared["id"], "reason": "expired"}
    assert closed_with(ws) == 4403


def test_expired_access_token_closes_the_connection(connect, client, shared):
    user_id = client.get("/auth/me", headers=shared["arjun"]).json()["id"]
    almost_expired = create_access_token(
        uuid.UUID(user_id), FAKE_SECRET, now=datetime.now(UTC) - ACCESS_TTL + timedelta(seconds=1)
    )
    ws = connect(almost_expired)
    subscribe(ws, shared["id"])
    time.sleep(1.2)
    client.put(f"/sessions/{shared['id']}/location", json=fix(), headers=shared["riya"])
    assert ws.receive_json() == {"type": "reauth_required"}
    assert closed_with(ws) == 4401


# ---------- pending guests ----------


def test_pending_guest_is_granted_live_when_sharer_approves(connect, client):
    _, riya = signup(client, "riya@example.com", "Riya")
    s = client.post("/sessions", json={"source": "tab_live"}, headers=riya).json()
    code = client.post(f"/sessions/{s['id']}/codes", headers=riya).json()["code"]
    joined = client.post("/codes/redeem", json={"code": code, "guest_label": "Mom"}).json()

    ws = connect(guest=joined["guest_token"])
    assert subscribe(ws, s["id"]) == {"type": "pending", "session_id": s["id"]}

    client.put(f"/sessions/{s['id']}/location", json=fix(), headers=riya)  # not delivered
    client.post(f"/sessions/{s['id']}/viewers/{joined['viewer_id']}/approve", headers=riya)
    granted = ws.receive_json()
    assert granted["type"] == "granted" and granted["location"] is not None

    client.put(f"/sessions/{s['id']}/location", json=fix(lat=30.9), headers=riya)
    assert ws.receive_json()["location"]["lat"] == 30.9
    ws.close()


# ---------- protocol hygiene ----------


def test_malformed_messages_close_the_connection(connect, shared):
    ws = connect(bearer(shared["arjun"]))
    ws.send_text("{not json")
    assert closed_with(ws) == 4400
    ws = connect(bearer(shared["arjun"]))
    ws.send_json({"type": "dance", "session_id": shared["id"]})
    assert closed_with(ws) == 4400


def test_closing_a_socket_unsubscribes_it(connect, client, shared):
    ws = connect(bearer(shared["arjun"]))
    subscribe(ws, shared["id"])
    hub = client.app.state.hub
    assert hub.subscriber_count(uuid.UUID(shared["id"])) == 1
    ws.close()
    time.sleep(0.2)
    assert hub.subscriber_count(uuid.UUID(shared["id"])) == 0


def test_a_fresh_login_token_works(connect, client, shared):
    tokens = login(client, "arjun@example.com")
    ws = connect(tokens["access_token"])
    assert subscribe(ws, shared["id"])["type"] == "subscribed"
    ws.close()
