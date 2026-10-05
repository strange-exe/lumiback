"""Small helpers shared by API tests."""

import re

from fastapi.testclient import TestClient

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
    r = client.post("/auth/register", json={"name": name, "email": email, "password": PASSWORD})
    assert r.status_code == 201, r.text
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
