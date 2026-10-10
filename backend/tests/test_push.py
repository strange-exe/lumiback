"""Push: device tokens, who gets notified for what, the Expo sender, and the overdue sweep."""

import asyncio
import json
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import text

from app.jobs.expiry import sweep
from app.push import ExpoPushSender, MemoryPushSender, PushMessage
from tests.helpers import signup

TOKEN = "ExponentPushToken[riyaPhone0001]"
OTHER = "ExponentPushToken[arjunPhone002]"


@pytest.fixture
def push(client) -> MemoryPushSender:
    sender = MemoryPushSender()
    client.app.state.push = sender
    return sender


def register_token(client, headers, token=TOKEN, muted=()):
    r = client.post(
        "/devices/push-token",
        json={"token": token, "platform": "android", "muted": list(muted)},
        headers=headers,
    )
    assert r.status_code == 204, r.text


def tokens(db) -> list[tuple[str, str]]:
    return [
        tuple(r)
        for r in db.execute(
            text(
                "SELECT t.token, u.email FROM push_tokens t JOIN users u ON u.id = t.user_id "
                "ORDER BY t.token"
            )
        )
    ]


# ---------- device tokens ----------


def test_register_is_idempotent(client, db):
    _, riya = signup(client, "riya@example.com", "Riya")
    register_token(client, riya)
    register_token(client, riya)
    assert tokens(db) == [(TOKEN, "riya@example.com")]


def test_a_token_follows_whoever_signed_in_last(client, db):
    _, riya = signup(client, "riya@example.com", "Riya")
    _, arjun = signup(client, "arjun@example.com", "Arjun")
    register_token(client, riya)
    register_token(client, arjun)  # same phone, handed over
    assert tokens(db) == [(TOKEN, "arjun@example.com")]


def test_only_the_owner_can_remove_a_token(client, db):
    _, riya = signup(client, "riya@example.com", "Riya")
    _, arjun = signup(client, "arjun@example.com", "Arjun")
    register_token(client, riya)
    body = {"token": TOKEN, "platform": "android"}
    assert client.post("/devices/push-token/remove", json=body, headers=arjun).status_code == 204
    assert tokens(db) == [(TOKEN, "riya@example.com")]
    assert client.post("/devices/push-token/remove", json=body, headers=riya).status_code == 204
    assert tokens(db) == []


@pytest.mark.parametrize("token", ["not-a-token", "ExponentPushToken[]", "ExpoPushToken[a b]"])
def test_malformed_tokens_are_refused(client, token):
    _, riya = signup(client, "riya@example.com", "Riya")
    r = client.post(
        "/devices/push-token", json={"token": token, "platform": "android"}, headers=riya
    )
    assert r.status_code == 422


def test_registering_needs_an_account(client):
    body = {"token": TOKEN, "platform": "android"}
    assert client.post("/devices/push-token", json=body).status_code == 401


# ---------- who gets notified ----------


def open_share(client, headers) -> dict:
    r = client.post("/sessions", json={"source": "app", "duration_minutes": 60}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def test_follow_request_and_approval_are_pushed(client, push):
    _, riya = signup(client, "riya@example.com", "Riya")
    _, arjun = signup(client, "arjun@example.com", "Arjun")
    register_token(client, riya, TOKEN)
    register_token(client, arjun, OTHER)
    share = open_share(client, riya)
    code = client.post(f"/sessions/{share['id']}/codes", headers=riya).json()["code"]

    joined = client.post("/codes/redeem", json={"code": code}, headers=arjun)
    assert joined.status_code == 200, joined.text
    assert push.outbox == [
        (
            [TOKEN],
            PushMessage(
                title="Arjun wants to follow you",
                body="Open Lumiback to approve or decline.",
                url="/live",
            ),
        )
    ]

    viewer_id = joined.json()["viewer_id"]
    r = client.post(f"/sessions/{share['id']}/viewers/{viewer_id}/approve", headers=riya)
    assert r.status_code == 200, r.text
    assert push.outbox[-1] == (
        [OTHER],
        PushMessage(
            title="Riya approved you",
            body="You can see their live location now.",
            url="/live",
            channel="share-status",
        ),
    )


def test_guests_get_no_push_and_users_without_devices_are_skipped(client, push):
    _, riya = signup(client, "riya@example.com", "Riya")  # no device registered
    share = open_share(client, riya)
    code = client.post(f"/sessions/{share['id']}/codes", headers=riya).json()["code"]
    joined = client.post("/codes/redeem", json={"code": code, "guest_label": "Mom"}).json()
    client.post(f"/sessions/{share['id']}/viewers/{joined['viewer_id']}/approve", headers=riya)
    assert push.outbox == []


def test_dead_tokens_are_pruned_after_a_send(client, db, push):
    _, riya = signup(client, "riya@example.com", "Riya")
    _, arjun = signup(client, "arjun@example.com", "Arjun")
    register_token(client, riya, TOKEN)
    push.dead.add(TOKEN)  # Expo says the app was uninstalled
    share = open_share(client, riya)
    code = client.post(f"/sessions/{share['id']}/codes", headers=riya).json()["code"]
    client.post("/codes/redeem", json={"code": code}, headers=arjun)
    assert len(push.outbox) == 1
    assert tokens(db) == []


def test_a_failing_sender_never_breaks_the_request(client):
    class Broken:
        async def send(self, tokens, message):
            raise httpx.ConnectError("push service down")

    client.app.state.push = Broken()
    _, riya = signup(client, "riya@example.com", "Riya")
    _, arjun = signup(client, "arjun@example.com", "Arjun")
    register_token(client, riya)
    share = open_share(client, riya)
    code = client.post(f"/sessions/{share['id']}/codes", headers=riya).json()["code"]
    assert client.post("/codes/redeem", json={"code": code}, headers=arjun).status_code == 200


def test_muted_channels_are_skipped_per_phone(client, db, push):
    _, riya = signup(client, "riya@example.com", "Riya")
    _, arjun = signup(client, "arjun@example.com", "Arjun")
    register_token(client, riya, TOKEN, muted=["follow-requests"])
    register_token(client, riya, "ExponentPushToken[riyaTablet003]")  # her other device
    share = open_share(client, riya)
    code = client.post(f"/sessions/{share['id']}/codes", headers=riya).json()["code"]
    client.post("/codes/redeem", json={"code": code}, headers=arjun)
    assert push.outbox[-1][0] == ["ExponentPushToken[riyaTablet003]"]

    register_token(client, riya, TOKEN, muted=[])  # switched back on
    stored = db.execute(text("SELECT muted FROM push_tokens WHERE token = :t"), {"t": TOKEN})
    assert stored.scalar_one() == []


def test_unknown_channels_cant_be_muted(client):
    _, riya = signup(client, "riya@example.com", "Riya")
    r = client.post(
        "/devices/push-token",
        json={"token": TOKEN, "platform": "android", "muted": ["everything"]},
        headers=riya,
    )
    assert r.status_code == 422


# ---------- Expo sender ----------


def test_expo_sender_batches_and_reports_unregistered_devices():
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        sent = json.loads(request.content)
        tickets = [
            {"status": "error", "details": {"error": "DeviceNotRegistered"}}
            if m["to"].endswith("dead]")
            else {"status": "ok", "id": "x"}
            for m in sent
        ]
        return httpx.Response(200, json={"data": tickets})

    sender = ExpoPushSender("expo-access", transport=httpx.MockTransport(handler))
    many = [f"ExponentPushToken[t{i:04}]" for i in range(150)] + ["ExponentPushToken[dead]"]
    message = PushMessage(title="Hi", body="There", url="/today", channel="reminders")

    dead = asyncio.run(sender.send(many, message))

    assert dead == {"ExponentPushToken[dead]"}
    assert [len(json.loads(r.content)) for r in requests] == [100, 51]
    assert requests[0].headers["Authorization"] == "Bearer expo-access"
    first = json.loads(requests[0].content)[0]
    assert first == {
        "to": "ExponentPushToken[t0000]",
        "title": "Hi",
        "body": "There",
        "data": {"url": "/today"},
        "sound": "default",
        "priority": "high",
        "channelId": "reminders",
    }


def test_expo_sender_omits_a_missing_url():
    sent: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.extend(json.loads(request.content))
        return httpx.Response(200, json={"data": [{"status": "ok", "id": "x"}]})

    sender = ExpoPushSender(None, transport=httpx.MockTransport(handler))
    message = PushMessage(title="Hi", body="There", channel="return-reminders")
    assert asyncio.run(sender.send([TOKEN], message)) == set()
    assert sent[0]["data"] == {}  # the app then opens its default screen


def test_notify_user_counts_the_phones_it_reached(client, push):
    from app.push import notify_user

    _, riya = signup(client, "riya@example.com", "Riya")
    register_token(client, riya, TOKEN)
    register_token(client, riya, OTHER, muted=["share-status"])
    me = client.get("/auth/me", headers=riya).json()["id"]

    def send(message: PushMessage) -> int:
        maker = client.app.state.sessionmaker
        return client.portal.call(notify_user, maker, push, uuid.UUID(me), message)

    everyday = PushMessage(title="Hi", body="There", url="/today", channel="share-status")
    assert send(everyday) == 1  # the other phone muted it
    push.dead.add(TOKEN)
    assert send(everyday) == 0  # gone: reached nobody
    assert send(PushMessage(title="Late", body="OK?", urgent=True)) == 1  # muted, but urgent


# ---------- sweep: overdue push + scan retention ----------


def make_late(db, by: str) -> None:
    db.execute(
        text(
            "UPDATE outings SET left_at = now() - interval '3 hours', "
            "expected_return_at = now() - CAST(:by AS interval)"
        ),
        {"by": by},
    )
    db.commit()


def run_sweep(client, push):
    return client.portal.call(sweep, client.app.state.sessionmaker, client.app.state.hub, push)


def test_overdue_students_are_pushed_once(client, db, push):
    _, riya = signup(client, "riya@example.com", "Riya")
    register_token(client, riya)
    due = (datetime.now(UTC) + timedelta(hours=1)).isoformat()
    client.post("/outings", json={"expected_return_at": due}, headers=riya)

    assert run_sweep(client, push).overdue_notified == 0  # not late yet

    make_late(db, "20 minutes")
    assert run_sweep(client, push).overdue_notified == 0  # late, but within the grace period

    make_late(db, "31 minutes")
    assert run_sweep(client, push).overdue_notified == 1
    assert push.outbox[-1][0] == [TOKEN]
    assert push.outbox[-1][1].url == "/today"

    assert run_sweep(client, push).overdue_notified == 0  # never twice
    assert len(push.outbox) == 1


def test_returned_outings_are_never_overdue(client, db, push):
    _, riya = signup(client, "riya@example.com", "Riya")
    register_token(client, riya)
    due = (datetime.now(UTC) + timedelta(hours=1)).isoformat()
    client.post("/outings", json={"expected_return_at": due}, headers=riya)
    client.post("/outings/current/return", headers=riya)
    make_late(db, "2 hours")
    assert run_sweep(client, push).overdue_notified == 0
    assert push.outbox == []


def test_old_scans_are_deleted_after_the_retention_period(client, db, push):
    _, riya = signup(client, "riya@example.com", "Riya")
    for _ in range(3):
        client.post(
            "/gates/scan",
            json={"qr": "garbage", "lat": 30.0, "lng": 78.0, "accuracy_m": 5},
            headers=riya,
        )
    db.execute(
        text(
            "INSERT INTO campus_settings (id, scan_retention_days) VALUES (1, 30) "
            "ON CONFLICT (id) DO UPDATE SET scan_retention_days = 30"
        )
    )
    db.execute(
        text(
            "UPDATE gate_scans SET scanned_at = now() - interval '31 days' "
            "WHERE id IN (SELECT id FROM gate_scans ORDER BY id LIMIT 2)"
        )
    )
    db.commit()
    assert run_sweep(client, push).deleted_scans == 2
    assert db.execute(text("SELECT count(*) FROM gate_scans")).scalar_one() == 1
