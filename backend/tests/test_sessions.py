"""Share sessions: who can create/see/stop them (A2), viewers must be contacts (A8),
stop deletes the location (A9), expiry enforced inline without the sweep job (A4, HTTP part)."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from app.realtime import AccessChanged
from tests.helpers import befriend, share_with, signup


@pytest.fixture
def people(client):
    """riya shares; arjun is her accepted contact; mallory is a stranger."""
    riya, riya_h = signup(client, "riya@example.com", "Riya")
    arjun, arjun_h = signup(client, "arjun@example.com", "Arjun")
    mallory, mallory_h = signup(client, "mallory@example.com", "Mallory")
    befriend(client, riya_h, "arjun@example.com", arjun_h)
    return {
        "riya": (riya, riya_h),
        "arjun": (arjun, arjun_h),
        "mallory": (mallory, mallory_h),
    }


def test_create_shares_with_contacts_immediately(client, people):
    riya, riya_h = people["riya"]
    arjun, _ = people["arjun"]
    s = share_with(client, riya_h, [arjun["id"]], minutes=30)
    assert s["status"] == "active"
    assert s["source"] == "manual" and s["ends_when"] == "duration"
    assert [(v["name"], v["kind"], v["status"]) for v in s["viewers"]] == [
        ("Arjun", "user", "granted")
    ]
    ends = datetime.fromisoformat(s["ends_at"])
    assert timedelta(minutes=29) < ends - datetime.now(UTC) <= timedelta(minutes=30)


@pytest.mark.parametrize(
    "body",
    [
        {"source": "manual", "viewer_user_ids": []},
        {"source": "manual", "duration_minutes": 481, "viewer_user_ids": ["{arjun}"]},
        {"source": "manual", "duration_minutes": 4, "viewer_user_ids": ["{arjun}"]},
        {"source": "manual", "viewer_user_ids": ["{arjun}", "{arjun}"]},
        {"source": "tab_live", "viewer_user_ids": ["{arjun}"]},
        {"source": "tab_live", "duration_minutes": 241},
        {"source": "outing", "viewer_user_ids": ["{arjun}"]},
        {"source": "pairing", "viewer_user_ids": ["{arjun}"]},
    ],
)
def test_invalid_session_requests_rejected(client, people, body):
    arjun, _ = people["arjun"]
    body = {
        **body,
        "viewer_user_ids": [arjun["id"] for _ in body.get("viewer_user_ids", [])],
    }
    r = client.post("/sessions", json=body, headers=people["riya"][1])
    assert r.status_code == 422


def test_viewers_must_be_accepted_contacts(client, people):
    """A8."""
    riya_h = people["riya"][1]
    mallory, mallory_h = people["mallory"]
    stranger_ids = [mallory["id"], str(uuid.uuid4())]

    pending = client.post("/contacts", json={"email": "mallory@example.com"}, headers=riya_h)
    assert pending.json()["status"] == "pending"
    for viewer in stranger_ids:
        r = client.post(
            "/sessions",
            json={"source": "manual", "viewer_user_ids": [viewer]},
            headers=riya_h,
        )
        assert r.status_code == 422, viewer

    # A contact of someone else is not my contact.
    arjun, arjun_h = people["arjun"]
    befriend(client, mallory_h, "arjun@example.com", arjun_h)
    r = client.post(
        "/sessions",
        json={"source": "manual", "viewer_user_ids": [arjun["id"], mallory["id"]]},
        headers=riya_h,
    )
    assert r.status_code == 422


def test_strangers_cannot_see_or_touch_a_session(client, people):
    """A2: no relation -> 404 for every operation."""
    s = share_with(client, people["riya"][1], [people["arjun"][0]["id"]])
    mallory_h = people["mallory"][1]
    viewer_id = s["viewers"][0]["id"]
    assert client.get(f"/sessions/{s['id']}", headers=mallory_h).status_code == 404
    assert client.post(f"/sessions/{s['id']}/stop", headers=mallory_h).status_code == 404
    assert (
        client.post(
            f"/sessions/{s['id']}/viewers/{viewer_id}/revoke", headers=mallory_h
        ).status_code
        == 404
    )
    assert client.get("/sessions/watching", headers=mallory_h).json() == []
    assert client.get("/sessions/mine", headers=mallory_h).json() == []
    assert client.get(f"/sessions/{uuid.uuid4()}", headers=mallory_h).status_code == 404


def test_viewer_sees_limited_view_and_cannot_manage(client, people):
    s = share_with(client, people["riya"][1], [people["arjun"][0]["id"]])
    arjun_h = people["arjun"][1]

    r = client.get(f"/sessions/{s['id']}", headers=arjun_h)
    assert r.status_code == 200
    assert r.json()["sharer"]["name"] == "Riya"
    assert "viewers" not in r.json()  # viewers don't see who else is watching

    watching = client.get("/sessions/watching", headers=arjun_h).json()
    assert [w["id"] for w in watching] == [s["id"]]

    assert client.post(f"/sessions/{s['id']}/stop", headers=arjun_h).status_code == 404


def test_stop_ends_access_and_deletes_location(client, people, db):
    """A9 + one-tap stop."""
    riya_h, arjun_h = people["riya"][1], people["arjun"][1]
    s = share_with(client, riya_h, [people["arjun"][0]["id"]])
    db.execute(text("INSERT INTO locations VALUES (:s, 30.3, 78.0, 5, now())"), {"s": s["id"]})
    db.commit()

    seen: list = []

    async def spy(event):
        seen.append(event)

    client.app.state.hub.subscribe(uuid.UUID(s["id"]), spy)

    r = client.post(f"/sessions/{s['id']}/stop", headers=riya_h)
    assert r.status_code == 200
    assert r.json()["status"] == "revoked"
    assert r.json()["ended_reason"] == "stopped_by_sharer"

    assert db.execute(text("SELECT count(*) FROM locations")).scalar_one() == 0
    assert client.get(f"/sessions/{s['id']}", headers=arjun_h).status_code == 403
    assert client.get("/sessions/watching", headers=arjun_h).json() == []
    assert seen == [AccessChanged(uuid.UUID(s["id"]))]

    again = client.post(f"/sessions/{s['id']}/stop", headers=riya_h)  # idempotent
    assert again.status_code == 200 and again.json()["status"] == "revoked"
    assert len(seen) == 1  # no duplicate notification


def test_revoking_one_viewer_keeps_the_others(client, people):
    riya_h = people["riya"][1]
    arjun, arjun_h = people["arjun"]
    mallory, mallory_h = people["mallory"]
    befriend(client, riya_h, "mallory@example.com", mallory_h)
    s = share_with(client, riya_h, [arjun["id"], mallory["id"]])
    arjun_viewer = next(v for v in s["viewers"] if v["name"] == "Arjun")

    r = client.post(f"/sessions/{s['id']}/viewers/{arjun_viewer['id']}/revoke", headers=riya_h)
    assert r.status_code == 200
    assert {v["name"]: v["status"] for v in r.json()["viewers"]} == {
        "Arjun": "revoked",
        "Mallory": "granted",
    }
    assert client.get(f"/sessions/{s['id']}", headers=arjun_h).status_code == 403
    assert client.get(f"/sessions/{s['id']}", headers=mallory_h).status_code == 200

    unknown = client.post(f"/sessions/{s['id']}/viewers/{uuid.uuid4()}/revoke", headers=riya_h)
    assert unknown.status_code == 404


def test_expired_session_denies_access_without_the_sweep_job(client, people, db):
    """A4 (HTTP): expiry is enforced by can_view itself, not by a background job."""
    riya_h, arjun_h = people["riya"][1], people["arjun"][1]
    s = share_with(client, riya_h, [people["arjun"][0]["id"]])
    db.execute(
        text(
            "UPDATE share_sessions SET created_at = now() - interval '2 hours', "
            "ends_at = now() - interval '1 second' WHERE id = :s"
        ),
        {"s": s["id"]},
    )
    db.commit()

    assert client.get(f"/sessions/{s['id']}", headers=arjun_h).status_code == 403
    assert client.get("/sessions/watching", headers=arjun_h).json() == []
    mine = client.get("/sessions/mine", headers=riya_h).json()
    assert [m["status"] for m in mine] == ["ended"]  # effective status; row still 'active'


def test_mine_lists_active_and_recent(client, people):
    riya_h = people["riya"][1]
    arjun_id = people["arjun"][0]["id"]
    first = share_with(client, riya_h, [arjun_id])
    client.post(f"/sessions/{first['id']}/stop", headers=riya_h)
    second = share_with(client, riya_h, [arjun_id])
    mine = client.get("/sessions/mine", headers=riya_h).json()
    assert [(m["id"], m["status"]) for m in mine] == [
        (second["id"], "active"),
        (first["id"], "revoked"),
    ]


def test_removing_contact_notifies_live_subscribers(client, people):
    riya_h, arjun_h = people["riya"][1], people["arjun"][1]
    s = share_with(client, riya_h, [people["arjun"][0]["id"]])
    seen: list = []

    async def spy(event):
        seen.append(event)

    client.app.state.hub.subscribe(uuid.UUID(s["id"]), spy)
    contact_id = client.get("/contacts", headers=arjun_h).json()["incoming"][0]["id"]
    assert client.delete(f"/contacts/{contact_id}", headers=arjun_h).status_code == 204
    assert seen == [AccessChanged(uuid.UUID(s["id"]))]
    assert client.get(f"/sessions/{s['id']}", headers=arjun_h).status_code == 403


def test_stop_records_a_closed_tab_as_the_reason(client, people):
    """The share page sends this when its tab closes (navigator.sendBeacon)."""
    riya_h = people["riya"][1]
    s = client.post("/sessions", json={"source": "tab_live"}, headers=riya_h).json()
    r = client.post(f"/sessions/{s['id']}/stop", json={"reason": "tab_closed"}, headers=riya_h)
    assert r.status_code == 200
    assert (r.json()["status"], r.json()["ended_reason"]) == ("revoked", "tab_closed")


def test_stop_rejects_made_up_reasons(client, people):
    riya_h = people["riya"][1]
    s = client.post("/sessions", json={"source": "tab_live"}, headers=riya_h).json()
    r = client.post(f"/sessions/{s['id']}/stop", json={"reason": "expired"}, headers=riya_h)
    assert r.status_code == 422
