"""Deleting an account removes every trace of it, and only with the password."""

from datetime import UTC, datetime

import pytest
from sqlalchemy import text
from starlette.websockets import WebSocketDisconnect

from tests.helpers import PASSWORD, befriend, share_with, signup

TABLES_WITH_USER_DATA = [
    "users",
    "outings",
    "share_sessions",
    "share_viewers",
    "locations",
    "contacts",
    "refresh_tokens",
    "access_log",
]


def counts(db) -> dict[str, int]:
    return {
        t: db.execute(text(f"SELECT count(*) FROM {t}")).scalar_one() for t in TABLES_WITH_USER_DATA
    }  # noqa: S608


def test_wrong_password_deletes_nothing(client, db):
    _, riya = signup(client, "riya@example.com", "Riya")
    before = counts(db)
    r = client.post("/auth/delete-account", json={"password": "not-my-password"}, headers=riya)
    assert r.status_code == 403
    assert counts(db) == before
    assert client.get("/auth/me", headers=riya).status_code == 200


def test_deleting_removes_the_account_and_everything_tied_to_it(client, db):
    riya_user, riya = signup(client, "riya@example.com", "Riya")
    arjun_user, arjun = signup(client, "arjun@example.com", "Arjun")
    befriend(client, riya, "arjun@example.com", arjun)
    befriend(client, arjun, "riya@example.com", riya)
    client.post(
        "/outings",
        json={"expected_return_at": "2099-01-01T00:00:00+05:30", "destination": "Library"},
        headers=riya,
    )
    s = share_with(client, riya, [arjun_user["id"]])
    fix = {"lat": 30.3, "lng": 78.0, "accuracy_m": 5, "recorded_at": datetime.now(UTC).isoformat()}
    client.put(f"/sessions/{s['id']}/location", json=fix, headers=riya)
    client.get(f"/sessions/{s['id']}/location", headers=arjun)  # an access-log row

    r = client.post("/auth/delete-account", json={"password": PASSWORD}, headers=riya)
    assert r.status_code == 204

    for table, user_column in [
        ("users", "id"),
        ("outings", "student_id"),
        ("share_sessions", "sharer_id"),
        ("contacts", "owner_id"),
        ("contacts", "contact_user_id"),
        ("refresh_tokens", "user_id"),
    ]:
        left = db.execute(
            text(f"SELECT count(*) FROM {table} WHERE {user_column} = :u"),  # noqa: S608
            {"u": riya_user["id"]},
        ).scalar_one()
        assert left == 0, table
    assert db.execute(text("SELECT count(*) FROM locations")).scalar_one() == 0
    assert db.execute(text("SELECT count(*) FROM access_log")).scalar_one() == 0
    # Arjun's own account is untouched.
    assert client.get("/auth/me", headers=arjun).json()["id"] == arjun_user["id"]
    # The deleted account's token is useless and the email can sign up again.
    assert client.get("/auth/me", headers=riya).status_code == 401


def test_viewers_of_a_live_share_are_cut_off(client):
    _, riya = signup(client, "riya@example.com", "Riya")
    arjun_user, arjun = signup(client, "arjun@example.com", "Arjun")
    befriend(client, riya, "arjun@example.com", arjun)
    s = share_with(client, riya, [arjun_user["id"]])

    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "auth", "token": arjun["Authorization"].removeprefix("Bearer ")})
        assert ws.receive_json()["type"] == "ready"
        ws.send_json({"type": "subscribe", "session_id": s["id"]})
        assert ws.receive_json()["type"] == "subscribed"

        client.post("/auth/delete-account", json={"password": PASSWORD}, headers=riya)

        assert ws.receive_json()["type"] == "ended"
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()


def test_password_guessing_is_rate_limited(client):
    _, riya = signup(client, "riya@example.com", "Riya")
    for _ in range(5):
        r = client.post("/auth/delete-account", json={"password": "guess"}, headers=riya)
        assert r.status_code == 403
    r = client.post("/auth/delete-account", json={"password": PASSWORD}, headers=riya)
    assert r.status_code == 429  # even the right password, once locked
    assert client.get("/auth/me", headers=riya).status_code == 200


def test_requires_sign_in(client):
    assert client.post("/auth/delete-account", json={"password": PASSWORD}).status_code == 401
