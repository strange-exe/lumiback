"""Small helpers shared by API tests."""

from fastapi.testclient import TestClient

PASSWORD = "correct-horse-battery"


def register(client: TestClient, email: str, name: str = "Test User") -> dict:
    r = client.post("/auth/register", json={"name": name, "email": email, "password": PASSWORD})
    assert r.status_code == 201, r.text
    return r.json()


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
