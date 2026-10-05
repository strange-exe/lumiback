"""Auth: registration rules, login, token validation, refresh rotation (A10), limits (A12)."""

import hashlib
import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from sqlalchemy import text

from app.security.rate_limit import RateLimiter
from app.security.tokens import create_access_token
from tests.conftest import FAKE_SECRET
from tests.helpers import PASSWORD, auth_header, login, register


class FakeClock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


@pytest.fixture
def clock(client) -> FakeClock:
    fake = FakeClock()
    client.app.state.limiter = RateLimiter(clock=fake)
    return fake


# ---------- registration ----------


def test_register_stores_argon2_hash_and_lowercase_email(client, db):
    user = register(client, "Riya.Sharma@GEU.ac.in", "Riya Sharma")
    assert user["email"] == "riya.sharma@geu.ac.in"
    stored = db.execute(text("SELECT password_hash FROM users")).scalar_one()
    assert stored.startswith("$argon2id$")
    assert PASSWORD not in stored


@pytest.mark.parametrize(
    ("password", "reason"),
    [
        ("short1", "at least 10"),
        ("password123", "too common"),
        ("aaaaaaaaaaaa", "too common"),
        ("riyasharma-2029", "name or email"),
    ],
)
def test_register_rejects_weak_passwords(client, password, reason):
    r = client.post(
        "/auth/register",
        json={"name": "Riya Sharma", "email": "riyasharma@geu.ac.in", "password": password},
    )
    assert r.status_code == 422
    assert reason in r.text
    assert password not in r.text  # never echo the password back


def test_register_rejects_duplicate_email_case_insensitively(client):
    register(client, "dup@example.com")
    r = client.post(
        "/auth/register", json={"name": "X", "email": "DUP@example.com", "password": PASSWORD}
    )
    assert r.status_code == 409


def test_register_rejects_unknown_fields(client):
    r = client.post(
        "/auth/register",
        json={"name": "X", "email": "x@example.com", "password": PASSWORD, "role": "admin"},
    )
    assert r.status_code == 422


def test_validation_errors_never_echo_submitted_values(client):
    secret = "x" * 2000  # over the login max length -> 422
    r = client.post("/auth/login", json={"email": "not-an-email", "password": secret})
    assert r.status_code == 422
    assert secret not in r.text
    assert "not-an-email" not in r.text
    assert all(set(e) <= {"type", "loc", "msg"} for e in r.json()["detail"])


def test_register_is_rate_limited_per_ip(client, clock):
    for i in range(5):
        register(client, f"u{i}@example.com")
    r = client.post(
        "/auth/register", json={"name": "X", "email": "u9@example.com", "password": PASSWORD}
    )
    assert r.status_code == 429
    assert int(r.headers["Retry-After"]) > 0


# ---------- login ----------


def test_login_returns_working_tokens(client):
    user = register(client, "a@example.com")
    tokens = login(client, "A@example.com")
    assert tokens["token_type"] == "bearer"
    assert tokens["expires_in"] == 900
    me = client.get("/auth/me", headers=auth_header(tokens))
    assert me.status_code == 200
    assert me.json()["id"] == user["id"]


def test_wrong_password_and_unknown_email_look_identical(client):
    register(client, "a@example.com")
    wrong = client.post("/auth/login", json={"email": "a@example.com", "password": "nope-nope-1"})
    unknown = client.post("/auth/login", json={"email": "z@example.com", "password": PASSWORD})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()


def test_email_locked_after_five_failures_even_with_correct_password(client, clock):
    register(client, "a@example.com")
    for _ in range(5):
        r = client.post("/auth/login", json={"email": "a@example.com", "password": "wrong-pass-1"})
        assert r.status_code == 401
    locked = client.post("/auth/login", json={"email": "a@example.com", "password": PASSWORD})
    assert locked.status_code == 429
    assert "Retry-After" in locked.headers

    clock.t += 15 * 60 + 1  # window passes
    assert (
        client.post(
            "/auth/login", json={"email": "a@example.com", "password": PASSWORD}
        ).status_code
        == 200
    )


def test_successful_login_resets_failure_count(client, clock):
    register(client, "a@example.com")
    for _ in range(4):
        client.post("/auth/login", json={"email": "a@example.com", "password": "wrong-pass-1"})
    login(client, "a@example.com")
    for _ in range(4):
        client.post("/auth/login", json={"email": "a@example.com", "password": "wrong-pass-1"})
    assert login(client, "a@example.com")  # not locked: counter restarted after success


def test_login_is_rate_limited_per_ip_across_emails(client, clock):
    for i in range(20):
        client.post("/auth/login", json={"email": f"x{i}@example.com", "password": "whatever-1"})
    r = client.post("/auth/login", json={"email": "new@example.com", "password": "whatever-1"})
    assert r.status_code == 429


# ---------- access tokens ----------


def _me(client, token: str):
    return client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})


def test_me_requires_a_token(client):
    r = client.get("/auth/me")
    assert r.status_code == 401
    assert r.headers["WWW-Authenticate"] == "Bearer"


def test_expired_access_token_rejected(client):
    user = register(client, "a@example.com")
    old = create_access_token(
        uuid.UUID(user["id"]), FAKE_SECRET, now=datetime.now(UTC) - timedelta(minutes=16)
    )
    assert _me(client, old).status_code == 401


def test_token_signed_with_another_secret_rejected(client):
    user = register(client, "a@example.com")
    forged = create_access_token(uuid.UUID(user["id"]), "another-secret-" + "z" * 40)
    assert _me(client, forged).status_code == 401


def test_unsigned_alg_none_token_rejected(client):
    user = register(client, "a@example.com")
    now = datetime.now(UTC)
    payload = {
        "sub": user["id"],
        "typ": "access",
        "iss": "outing-api",
        "iat": now,
        "exp": now + timedelta(minutes=5),
    }
    unsigned = jwt.encode(payload, key=None, algorithm="none")
    assert _me(client, unsigned).status_code == 401


def test_refresh_token_cannot_be_used_as_access_token(client):
    register(client, "a@example.com")
    tokens = login(client, "a@example.com")
    assert _me(client, tokens["refresh_token"]).status_code == 401


def test_token_of_deleted_user_rejected(client, db):
    register(client, "a@example.com")
    tokens = login(client, "a@example.com")
    db.execute(text("DELETE FROM users"))
    db.commit()
    assert client.get("/auth/me", headers=auth_header(tokens)).status_code == 401


# ---------- refresh tokens (A10) ----------


def _refresh(client, token: str):
    return client.post("/auth/refresh", json={"refresh_token": token})


def test_refresh_tokens_are_stored_hashed(client, db):
    register(client, "a@example.com")
    tokens = login(client, "a@example.com")
    stored = db.execute(text("SELECT token_hash FROM refresh_tokens")).scalar_one()
    assert stored == hashlib.sha256(tokens["refresh_token"].encode()).digest()
    assert tokens["refresh_token"].encode() not in stored


def test_refresh_rotates_the_token(client):
    register(client, "a@example.com")
    first = login(client, "a@example.com")
    r = _refresh(client, first["refresh_token"])
    assert r.status_code == 200
    second = r.json()
    assert second["refresh_token"] != first["refresh_token"]
    assert client.get("/auth/me", headers=auth_header(second)).status_code == 200


def test_reusing_a_rotated_refresh_token_revokes_the_whole_family(client):
    """A10: replaying a retired token logs out every holder of that login."""
    register(client, "a@example.com")
    first = login(client, "a@example.com")
    second = _refresh(client, first["refresh_token"]).json()

    assert _refresh(client, first["refresh_token"]).status_code == 401  # replay detected
    assert _refresh(client, second["refresh_token"]).status_code == 401  # family revoked


def test_reuse_does_not_affect_other_logins(client):
    register(client, "a@example.com")
    phone = login(client, "a@example.com")
    laptop = login(client, "a@example.com")
    _refresh(client, phone["refresh_token"])
    _refresh(client, phone["refresh_token"])  # replay on the phone family
    assert _refresh(client, laptop["refresh_token"]).status_code == 200


def test_expired_refresh_token_rejected(client, db):
    register(client, "a@example.com")
    tokens = login(client, "a@example.com")
    db.execute(text("UPDATE refresh_tokens SET expires_at = now() - interval '1 second'"))
    db.commit()
    assert _refresh(client, tokens["refresh_token"]).status_code == 401


def test_garbage_refresh_token_rejected(client):
    assert _refresh(client, "not-a-real-token").status_code == 401


def test_logout_revokes_the_family(client):
    register(client, "a@example.com")
    first = login(client, "a@example.com")
    second = _refresh(client, first["refresh_token"]).json()
    r = client.post("/auth/logout", json={"refresh_token": second["refresh_token"]})
    assert r.status_code == 204
    assert _refresh(client, second["refresh_token"]).status_code == 401


def test_logout_with_unknown_token_is_harmless(client):
    r = client.post("/auth/logout", json={"refresh_token": "unknown"})
    assert r.status_code == 204
