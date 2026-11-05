"""Data rights: "Download my data" and the fixed retention periods (audit rows, push tokens)."""

import json
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from app.jobs.expiry import sweep
from app.push import MemoryPushSender
from tests.helpers import befriend, share_with, signup

TOKEN = "ExponentPushToken[riyaPhone0001]"


def export(client, headers):
    r = client.get("/profile/export", headers=headers)
    assert r.status_code == 200, r.text
    return r


def run_sweep(client):
    return client.portal.call(
        sweep, client.app.state.sessionmaker, client.app.state.hub, MemoryPushSender()
    )


@pytest.fixture
def riya_with_history(client, db):
    """Riya with a profile, an outing, a request, a scan, a phone, a contact and a share Arjun
    watched. Arjun has his own outing and scan, which must never show up in Riya's export."""
    riya_user, riya = signup(client, "riya@example.com", "Riya")
    arjun_user, arjun = signup(client, "arjun@example.com", "Arjun")
    client.patch(
        "/profile",
        json={
            "contacts": {
                "phone": "9876543210",
                "emergency_name": "Meena",
                "emergency_relation": "Mother",
                "emergency_phone": "9876500000",
            }
        },
        headers=riya,
    )
    due = (datetime.now(UTC) + timedelta(hours=2)).isoformat()
    for who in (riya, arjun):
        r = client.post(
            "/outings", json={"expected_return_at": due, "destination": "Market"}, headers=who
        )
        assert r.status_code == 201, r.text
        client.post(
            "/gates/scan",
            json={"qr": "garbage", "lat": 30.0, "lng": 78.0, "accuracy_m": 5},
            headers=who,
        )
    db.execute(
        text(
            "INSERT INTO outing_requests (student_id, day, purpose, phone, emergency_name, "
            "emergency_relation, emergency_phone) VALUES "
            "(:s, CURRENT_DATE, 'Dentist', '9876543210', 'Meena', 'Mother', '9876500000')"
        ),
        {"s": riya_user["id"]},
    )
    db.commit()
    client.post(
        "/devices/push-token",
        json={"token": TOKEN, "platform": "android", "muted": ["follow-requests"]},
        headers=riya,
    )
    befriend(client, riya, "arjun@example.com", arjun)
    share = share_with(client, riya, [arjun_user["id"]])
    r = client.get(f"/sessions/{share['id']}/location", headers=arjun)
    assert r.status_code == 200, r.text
    return {"riya": riya, "arjun": arjun, "share": share}


def test_export_holds_the_users_own_data(client, riya_with_history):
    r = export(client, riya_with_history["riya"])
    assert r.headers["content-disposition"].startswith('attachment; filename="lumiback-data-')
    assert r.headers["cache-control"] == "no-store"
    data = r.json()

    assert data["format"] == "lumiback-export"
    assert data["account"]["email"] == "riya@example.com"
    assert data["profile"]["emergency_name"] == "Meena"
    assert [o["destination"] for o in data["outings"]] == ["Market"]
    assert [q["purpose"] for q in data["outing_requests"]] == ["Dentist"]
    assert [s["result"] for s in data["gate_scans"]] == ["bad_code"]
    assert data["push_devices"][0]["muted_channels"] == ["follow-requests"]
    assert [c["email"] for c in data["contacts"]] == ["arjun@example.com"]

    (share,) = data["share_sessions"]
    assert share["id"] == riya_with_history["share"]["id"]
    assert [v["name"] for v in share["viewers"]] == ["Arjun"]
    assert [(v["viewer_name"], v["kind"]) for v in share["viewed_by"]] == [("Arjun", "user")]


def test_export_never_holds_secrets_or_other_peoples_records(client, riya_with_history):
    raw = export(client, riya_with_history["riya"]).text
    data = json.loads(raw)
    for secret in ("password", "hash", TOKEN, "refresh"):
        assert secret not in raw, secret
    # Arjun's own outing and scan are his: only Riya's appear.
    assert len(data["outings"]) == 1
    assert len(data["gate_scans"]) == 1
    # Arjun's export shows what he watched, not Riya's share internals or her contacts.
    arjun = export(client, riya_with_history["arjun"]).json()
    assert arjun["share_sessions"] == []
    assert arjun["contacts"] == []
    assert [w["sharer_name"] for w in arjun["shares_watched"]] == ["Riya"]
    assert "9876543210" not in json.dumps(arjun)  # Riya's phone number


def test_export_holds_the_emergency_email_and_the_safe_return_address(client):
    _, riya = signup(client, "riya@example.com", "Riya")
    r = client.patch(
        "/profile",
        json={
            "contacts": {
                "phone": "9876543210",
                "emergency_name": "Meena",
                "emergency_relation": "Mother",
                "emergency_phone": "9876500000",
            },
            "emergency_email": "meena@gmail.com",
        },
        headers=riya,
    )
    assert r.status_code == 200, r.text
    out = client.post("/outings", json={"destination": "Market", "safe_return": True}, headers=riya)
    assert out.json()["safe_return_session_id"] is not None

    data = export(client, riya).json()
    assert data["profile"]["emergency_email"] == "meena@gmail.com"
    assert data["profile"]["emergency_name"] == "Meena"
    assert [o["safe_return_email"] for o in data["outings"]] == ["meena@gmail.com"]


def test_shares_watched_shows_when_a_share_started_only_to_granted_viewers(client):
    _, riya = signup(client, "riya@example.com", "Riya")
    arjun_user, arjun = signup(client, "arjun@example.com", "Arjun")
    befriend(client, riya, "arjun@example.com", arjun)
    share = share_with(client, riya, [arjun_user["id"]])
    [watched] = export(client, arjun).json()["shares_watched"]
    assert (watched["status"], watched["share_started_at"] is not None) == ("granted", True)

    [viewer] = share["viewers"]
    r = client.post(f"/sessions/{share['id']}/viewers/{viewer['id']}/revoke", headers=riya)
    assert r.status_code == 200, r.text
    [watched] = export(client, arjun).json()["shares_watched"]
    assert (watched["status"], watched["share_started_at"]) == ("revoked", None)


def test_export_needs_sign_in_and_is_rate_limited(client):
    assert client.get("/profile/export").status_code == 401
    _, riya = signup(client, "riya@example.com", "Riya")
    for _ in range(5):
        export(client, riya)
    r = client.get("/profile/export", headers=riya)
    assert r.status_code == 429
    assert "retry-after" in r.headers


def test_admin_audit_rows_are_deleted_after_a_year(client, db):
    db.execute(
        text(
            "INSERT INTO admin_audit (action, target, at) VALUES "
            "('role', 'old', now() - interval '366 days'), "
            "('role', 'recent', now() - interval '364 days')"
        )
    )
    db.commit()
    assert run_sweep(client).deleted_audit == 1
    assert db.execute(text("SELECT target FROM admin_audit")).scalars().all() == ["recent"]


def test_push_tokens_unseen_for_90_days_are_deleted(client, db):
    _, riya = signup(client, "riya@example.com", "Riya")
    for token in (TOKEN, "ExponentPushToken[riyaOldPhone02]"):
        r = client.post(
            "/devices/push-token", json={"token": token, "platform": "android"}, headers=riya
        )
        assert r.status_code == 204, r.text
    db.execute(
        text("UPDATE push_tokens SET last_seen_at = now() - interval '91 days' WHERE token <> :t"),
        {"t": TOKEN},
    )
    db.execute(
        text("UPDATE push_tokens SET last_seen_at = now() - interval '89 days' WHERE token = :t"),
        {"t": TOKEN},
    )
    db.commit()
    assert run_sweep(client).deleted_push_tokens == 1
    assert db.execute(text("SELECT token FROM push_tokens")).scalars().all() == [TOKEN]


def test_outings_and_shares_are_kept_however_old(client, db, riya_with_history):
    db.execute(
        text(
            "UPDATE outings SET left_at = left_at - interval '3 years', "
            "expected_return_at = expected_return_at - interval '3 years', "
            "returned_at = now() - interval '3 years'"
        )
    )
    db.commit()
    run_sweep(client)
    assert db.execute(text("SELECT count(*) FROM outings")).scalar_one() == 2
    assert db.execute(text("SELECT count(*) FROM share_sessions")).scalar_one() == 1
