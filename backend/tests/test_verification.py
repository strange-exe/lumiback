"""University-only registration and email verification."""

import hashlib
import hmac
import uuid

from sqlalchemy import text

from app.security.tokens import create_access_token
from tests.conftest import FAKE_SECRET
from tests.helpers import PASSWORD, last_code, register, signup

PEPPER = FAKE_SECRET[::-1]


def _register(client, email="riya@geu.ac.in"):
    return client.post(
        "/auth/register", json={"name": "Riya", "email": email, "password": PASSWORD}
    )


def _verify(client, email, code):
    return client.post("/auth/verify-email", json={"email": email, "code": code})


def _wrong(code: str) -> str:
    return f"{(int(code) + 1) % 10**6:06d}"


def test_only_allowed_domains_can_register(client):
    r = _register(client, "riya@gmail.com")
    assert r.status_code == 422
    assert "@geu.ac.in" in r.text
    # Look-alike domains are not the university's domain.
    assert _register(client, "riya@geu.ac.in.evil.com").status_code == 422
    assert _register(client, "riya@notgeu.ac.in").status_code == 422


def test_registration_emails_a_code_and_login_waits_for_verification(client):
    user = _register(client).json()
    assert user["email_verified"] is False
    outbox = client.app.state.mailer.outbox
    assert [m.to for m in outbox] == ["riya@geu.ac.in"]

    r = client.post("/auth/login", json={"email": "riya@geu.ac.in", "password": PASSWORD})
    assert r.status_code == 403
    assert r.json()["detail"] == "Email not verified"

    verified = _verify(client, "riya@geu.ac.in", last_code(client, "riya@geu.ac.in"))
    assert verified.status_code == 200 and verified.json()["email_verified"] is True
    r = client.post("/auth/login", json={"email": "riya@geu.ac.in", "password": PASSWORD})
    assert r.status_code == 200


def test_wrong_password_on_unverified_account_still_says_invalid(client):
    """Verification status is only revealed after the correct password."""
    _register(client)
    r = client.post("/auth/login", json={"email": "riya@geu.ac.in", "password": "wrong-pass-1"})
    assert r.status_code == 401


def test_code_is_stored_only_as_a_user_bound_hmac(client, db):
    user = _register(client).json()
    code = last_code(client, "riya@geu.ac.in")
    stored = db.execute(text("SELECT code_hash FROM email_verifications")).scalar_one()
    expected = hmac.new(PEPPER.encode(), f"{user['id']}:{code}".encode(), hashlib.sha256).digest()
    assert stored == expected


def test_code_is_burned_after_five_wrong_attempts(client):
    _register(client)
    code = last_code(client, "riya@geu.ac.in")
    for _ in range(5):
        assert _verify(client, "riya@geu.ac.in", _wrong(code)).status_code == 400
    assert _verify(client, "riya@geu.ac.in", code).status_code == 400  # even the right one

    client.post("/auth/resend-verification", json={"email": "riya@geu.ac.in"})
    fresh = last_code(client, "riya@geu.ac.in")
    assert _verify(client, "riya@geu.ac.in", fresh).status_code == 200


def test_expired_code_rejected(client, db):
    _register(client)
    code = last_code(client, "riya@geu.ac.in")
    db.execute(
        text(
            "UPDATE email_verifications SET created_at = now() - interval '1 hour', "
            "expires_at = now() - interval '1 second'"
        )
    )
    db.commit()
    assert _verify(client, "riya@geu.ac.in", code).status_code == 400


def test_a_new_code_replaces_the_old_one(client):
    _register(client)
    old = last_code(client, "riya@geu.ac.in")
    client.post("/auth/resend-verification", json={"email": "riya@geu.ac.in"})
    new = last_code(client, "riya@geu.ac.in")
    if old != new:  # 1-in-a-million chance they collide
        assert _verify(client, "riya@geu.ac.in", old).status_code == 400
    assert _verify(client, "riya@geu.ac.in", new).status_code == 200


def test_unknown_email_fails_exactly_like_a_wrong_code(client):
    _register(client)
    code = last_code(client, "riya@geu.ac.in")
    unknown = _verify(client, "nobody@geu.ac.in", code)
    wrong = _verify(client, "riya@geu.ac.in", _wrong(code))
    assert unknown.status_code == wrong.status_code == 400
    assert unknown.json() == wrong.json()


def test_verifying_twice_is_harmless(client):
    _register(client)
    code = last_code(client, "riya@geu.ac.in")
    assert _verify(client, "riya@geu.ac.in", code).status_code == 200
    assert _verify(client, "riya@geu.ac.in", code).status_code == 200


def test_resend_never_reveals_whether_an_account_exists(client):
    register(client, "verified@geu.ac.in")  # already verified
    _register(client)  # unverified
    sent_before = len(client.app.state.mailer.outbox)
    for email in ("nobody@geu.ac.in", "verified@geu.ac.in", "riya@geu.ac.in"):
        r = client.post("/auth/resend-verification", json={"email": email})
        assert r.status_code == 202, email
    sent = client.app.state.mailer.outbox[sent_before:]
    assert [m.to for m in sent] == ["riya@geu.ac.in"]  # only the unverified account got mail


def test_resend_is_rate_limited_per_email(client):
    _register(client)
    for _ in range(3):
        client.post("/auth/resend-verification", json={"email": "riya@geu.ac.in"})
    r = client.post("/auth/resend-verification", json={"email": "riya@geu.ac.in"})
    assert r.status_code == 429


def test_verify_failures_are_rate_limited_per_ip(client):
    for i in range(4):
        _register(client, f"s{i}@geu.ac.in")
    attempts = [_verify(client, f"s{i % 4}@geu.ac.in", "000000") for i in range(21)]
    assert attempts[-1].status_code == 429


def test_codes_must_be_six_digits(client):
    for bad in ("12345", "1234567", "12a456", "      "):
        assert _verify(client, "riya@geu.ac.in", bad).status_code == 422


def test_unverified_users_cannot_use_access_tokens(client):
    user = _register(client).json()
    token = create_access_token(uuid.UUID(user["id"]), FAKE_SECRET)
    r = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403


def test_contacts_must_be_university_addresses(client):
    _, riya = signup(client, "riya@geu.ac.in")
    r = client.post("/contacts", json={"email": "mom@gmail.com"}, headers=riya)
    assert r.status_code == 422
    assert (
        client.post("/contacts", json={"email": "arjun@geu.ac.in"}, headers=riya).status_code == 202
    )
