"""Contacts: owner-initiated, invitee-accepted, removable from either side, no enumeration."""

from sqlalchemy import text

from tests.helpers import register, signup


def _strip_volatile(contact: dict) -> dict:
    return {k: v for k, v in contact.items() if k not in {"id", "created_at", "email"}}


def test_invite_looks_identical_for_existing_and_unknown_accounts(client):
    """A12: inviting reveals nothing about whether the email is registered."""
    _, riya = signup(client, "riya@example.com")
    register(client, "arjun@example.com")

    existing = client.post("/contacts", json={"email": "arjun@example.com"}, headers=riya)
    unknown = client.post("/contacts", json={"email": "nobody@example.com"}, headers=riya)
    assert existing.status_code == unknown.status_code == 202
    assert _strip_volatile(existing.json()) == _strip_volatile(unknown.json())
    assert existing.json()["person"] is None

    listed = client.get("/contacts", headers=riya).json()["outgoing"]
    assert [_strip_volatile(c) for c in listed] == [_strip_volatile(unknown.json())] * 2


def test_invite_is_idempotent_and_case_insensitive(client):
    _, riya = signup(client, "riya@example.com")
    first = client.post("/contacts", json={"email": "Arjun@Example.com"}, headers=riya).json()
    again = client.post("/contacts", json={"email": "arjun@example.com"}, headers=riya).json()
    assert first["id"] == again["id"]
    assert first["email"] == "arjun@example.com"


def test_cannot_add_yourself(client):
    _, riya = signup(client, "riya@example.com")
    r = client.post("/contacts", json={"email": "RIYA@example.com"}, headers=riya)
    assert r.status_code == 422


def test_invitee_sees_and_accepts_the_invite(client):
    riya_user, riya = signup(client, "riya@example.com", "Riya")
    arjun_user, arjun = signup(client, "arjun@example.com", "Arjun")
    invite = client.post("/contacts", json={"email": "arjun@example.com"}, headers=riya).json()

    incoming = client.get("/contacts", headers=arjun).json()["incoming"]
    assert [(c["id"], c["owner"]["name"], c["status"]) for c in incoming] == [
        (invite["id"], "Riya", "pending")
    ]

    r = client.post(f"/contacts/{invite['id']}/accept", headers=arjun)
    assert r.status_code == 200
    assert r.json()["status"] == "accepted"

    outgoing = client.get("/contacts", headers=riya).json()["outgoing"][0]
    assert outgoing["status"] == "accepted"
    assert outgoing["person"] == {
        "id": arjun_user["id"],
        "name": "Arjun",
        "email": arjun_user["email"],
    }


def test_invite_reaches_someone_who_registers_later(client):
    _, riya = signup(client, "riya@example.com")
    invite = client.post("/contacts", json={"email": "late@example.com"}, headers=riya).json()
    _, late = signup(client, "late@example.com")
    assert client.post(f"/contacts/{invite['id']}/accept", headers=late).status_code == 200


def test_only_the_invited_person_can_accept(client):
    _, riya = signup(client, "riya@example.com")
    _, mallory = signup(client, "mallory@example.com")
    invite = client.post("/contacts", json={"email": "arjun@example.com"}, headers=riya).json()

    assert client.post(f"/contacts/{invite['id']}/accept", headers=mallory).status_code == 404
    assert client.post(f"/contacts/{invite['id']}/accept", headers=riya).status_code == 404


def test_users_cannot_see_other_peoples_contacts(client):
    _, riya = signup(client, "riya@example.com")
    _, mallory = signup(client, "mallory@example.com")
    client.post("/contacts", json={"email": "arjun@example.com"}, headers=riya)
    assert client.get("/contacts", headers=mallory).json() == {"outgoing": [], "incoming": []}


def test_either_side_can_remove(client):
    _, riya = signup(client, "riya@example.com")
    _, arjun = signup(client, "arjun@example.com")
    _, mallory = signup(client, "mallory@example.com")

    first = client.post("/contacts", json={"email": "arjun@example.com"}, headers=riya).json()
    assert client.delete(f"/contacts/{first['id']}", headers=mallory).status_code == 404
    assert client.delete(f"/contacts/{first['id']}", headers=arjun).status_code == 204  # decline

    second = client.post("/contacts", json={"email": "arjun@example.com"}, headers=riya).json()
    client.post(f"/contacts/{second['id']}/accept", headers=arjun)
    assert client.delete(f"/contacts/{second['id']}", headers=riya).status_code == 204
    assert client.get("/contacts", headers=arjun).json()["incoming"] == []


def test_removing_a_contact_revokes_their_live_access(client, db):
    riya_user, riya = signup(client, "riya@example.com")
    arjun_user, arjun = signup(client, "arjun@example.com")
    invite = client.post("/contacts", json={"email": "arjun@example.com"}, headers=riya).json()
    client.post(f"/contacts/{invite['id']}/accept", headers=arjun)

    ids = {"r": riya_user["id"], "a": arjun_user["id"]}
    session_id = db.execute(
        text(
            "INSERT INTO share_sessions (sharer_id, source, ends_when, ends_at) "
            "VALUES (:r, 'manual', 'duration', now() + interval '1 hour') RETURNING id"
        ),
        ids,
    ).scalar_one()
    db.execute(
        text(
            "INSERT INTO share_viewers (session_id, viewer_user_id, status, granted_at) "
            "VALUES (:s, :a, 'granted', now())"
        ),
        {"s": session_id, **ids},
    )
    db.commit()

    assert client.delete(f"/contacts/{invite['id']}", headers=arjun).status_code == 204
    status = db.execute(text("SELECT status FROM share_viewers")).scalar_one()
    assert status == "revoked"


def test_invites_are_rate_limited(client):
    _, riya = signup(client, "riya@example.com")
    for i in range(20):
        client.post("/contacts", json={"email": f"p{i}@example.com"}, headers=riya)
    r = client.post("/contacts", json={"email": "one-more@example.com"}, headers=riya)
    assert r.status_code == 429


def test_contacts_require_authentication(client):
    assert client.get("/contacts").status_code == 401
    assert client.post("/contacts", json={"email": "a@example.com"}).status_code == 401
