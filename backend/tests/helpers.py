"""Small helpers shared by API tests."""

import re

from fastapi.testclient import TestClient
from sqlalchemy import text

PASSWORD = "correct-horse-battery"


def last_code(client: TestClient, email: str) -> str:
    """The most recent verification code emailed to this address."""
    sent = [m for m in client.app.state.mailer.outbox if m.to == email.lower()]
    assert sent, f"no email sent to {email}"
    match = re.search(r"code is (\d{6})", sent[-1].body)
    assert match, sent[-1].body
    return match.group(1)


def verify(client: TestClient, email: str) -> dict:
    r = client.post("/auth/verify-email", json={"email": email, "code": last_code(client, email)})
    assert r.status_code == 200, r.text
    return r.json()


def register(
    client: TestClient, email: str, name: str = "Test User", *, verified: bool = True
) -> dict:
    """Sign up and (by default) verify. The account exists only after verification."""
    r = client.post("/auth/register", json={"name": name, "email": email, "password": PASSWORD})
    assert r.status_code == 202, r.text
    return verify(client, email) if verified else r.json()


def login(client: TestClient, email: str, password: str = PASSWORD) -> dict:
    r = client.post("/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()


def auth_header(tokens: dict) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def signup(client: TestClient, email: str, name: str = "Test User") -> tuple[dict, dict]:
    """Register + login. Returns (user, headers)."""
    user = register(client, email, name)
    return user, auth_header(login(client, email))


def befriend(client: TestClient, owner: dict, contact_email: str, contact: dict) -> None:
    """owner invites contact_email; the contact accepts."""
    invite = client.post("/contacts", json={"email": contact_email}, headers=owner).json()
    r = client.post(f"/contacts/{invite['id']}/accept", headers=contact)
    assert r.status_code == 200, r.text


def share_with(client: TestClient, sharer: dict, viewer_ids: list[str], minutes: int = 60) -> dict:
    r = client.post(
        "/sessions",
        json={"source": "manual", "duration_minutes": minutes, "viewer_user_ids": viewer_ids},
        headers=sharer,
    )
    assert r.status_code == 201, r.text
    return r.json()


def make_admin(db, email: str) -> None:
    """Promote directly in the database (the first admin comes from a script, not the API)."""
    db.execute(text("UPDATE users SET role = 'admin' WHERE email = :e"), {"e": email.lower()})
    db.commit()


GATE = {"name": "Main Gate", "lat": 30.2683, "lng": 77.9950, "radius_m": 75}


def create_gate(client: TestClient, admin: dict, **overrides) -> dict:
    """Returns {"gate": {...}, "kiosk_token": "..."}."""
    r = client.post("/admin/gates", json={**GATE, **overrides}, headers=admin)
    assert r.status_code == 201, r.text
    return r.json()


def kiosk_qr(client: TestClient, kiosk_token: str) -> str:
    r = client.get("/kiosk/qr", headers={"X-Kiosk-Token": kiosk_token})
    assert r.status_code == 200, r.text
    return r.json()["qr"]
