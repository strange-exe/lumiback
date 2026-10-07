"""University-only sign-up: nothing becomes an account until the emailed code is entered."""

import hashlib
import hmac
from datetime import UTC, datetime

from sqlalchemy import text

from app.jobs.expiry import sweep
from tests.conftest import FAKE_SECRET
from tests.helpers import PASSWORD, last_code, register, signup

PEPPER = FAKE_SECRET[::-1]
EMAIL = "riya@geu.ac.in"


def _register(client, email=EMAIL, password=PASSWORD, name="Riya"):
    return client.post("/auth/register", json={"name": name, "email": email, "password": password})


def _verify(client, email, code):
    return client.post("/auth/verify-email", json={"email": email, "code": code})


def _wrong(code: str) -> str:
    return f"{(int(code) + 1) % 10**6:06d}"


def _users(db) -> int:
    return db.execute(text("SELECT count(*) FROM users")).scalar_one()


def test_only_allowed_domains_can_register(client):
    r = _register(client, "riya@gmail.com")
    assert r.status_code == 422
    assert "@geu.ac.in" in r.text
    # Look-alike domains are not the university's domain.
    assert _register(client, "riya@geu.ac.in.evil.com").status_code == 422
    assert _register(client, "riya@notgeu.ac.in").status_code == 422


def test_listed_test_address_and_its_aliases_can_register(client):
    for email in ("tester@gmail.com", "tester+second@gmail.com"):
        r = _register(client, email)
        assert r.status_code == 202, r.text
        assert _verify(client, email, last_code(client, email)).status_code == 200
    # The rest of gmail.com stays closed.
    assert _register(client, "someone@gmail.com").status_code == 422


def test_no_account_exists_until_the_code_is_entered(client, db):
    r = _register(client)
    assert r.status_code == 202
    assert r.json() == {"email": EMAIL, "code_expires_in_minutes": 15}
    assert "id" not in r.json()  # there is no user to identify yet
    assert [m.to for m in client.app.state.mailer.outbox] == [EMAIL]
    assert _users(db) == 0

    login = client.post("/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert login.status_code == 401  # nothing to sign in to yet

    verified = _verify(client, EMAIL, last_code(client, EMAIL))
    assert verified.status_code == 200
    assert verified.json()["email_verified"] is True
    assert _users(db) == 1
    assert db.execute(text("SELECT count(*) FROM pending_registrations")).scalar_one() == 0
    login = client.post("/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert login.status_code == 200


def test_pending_signup_keeps_only_hashes(client, db):
    _register(client)
    code = last_code(client, EMAIL)
    row = db.execute(
        text("SELECT password_hash, code_hash FROM pending_registrations WHERE email = :e"),
        {"e": EMAIL},
    ).one()
    assert row.password_hash.startswith("$argon2id$") and PASSWORD not in row.password_hash
    expected = hmac.new(PEPPER.encode(), f"{EMAIL}:{code}".encode(), hashlib.sha256).digest()
    assert row.code_hash == expected


def test_registering_again_replaces_a_pending_signup(client):
    """Someone who doesn't own the inbox can't lock the address: the owner just signs up again."""
    _register(client, password="squatter-pass-2029", name="Not Riya")
    _register(client, name="Riya Sharma")
    assert _verify(client, EMAIL, last_code(client, EMAIL)).json()["name"] == "Riya Sharma"
    login = client.post("/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert login.status_code == 200


def test_a_verified_email_cannot_be_registered_again(client):
    register(client, EMAIL)
    assert _register(client).status_code == 409


def test_code_is_burned_after_five_wrong_attempts(client):
    _register(client)
    code = last_code(client, EMAIL)
    for _ in range(5):
        assert _verify(client, EMAIL, _wrong(code)).status_code == 400
    assert _verify(client, EMAIL, code).status_code == 400  # even the right one

    client.post("/auth/resend-verification", json={"email": EMAIL})
    assert _verify(client, EMAIL, last_code(client, EMAIL)).status_code == 200


def test_expired_code_rejected(client, db):
    _register(client)
    code = last_code(client, EMAIL)
    db.execute(
        text(
            "UPDATE pending_registrations SET created_at = now() - interval '1 hour', "
            "expires_at = now() - interval '1 second'"
        )
    )
    db.commit()
    assert _verify(client, EMAIL, code).status_code == 400


def test_a_new_code_replaces_the_old_one(client):
    _register(client)
    old = last_code(client, EMAIL)
    client.post("/auth/resend-verification", json={"email": EMAIL})
    new = last_code(client, EMAIL)
    if old != new:  # 1-in-a-million chance they collide
        assert _verify(client, EMAIL, old).status_code == 400
    assert _verify(client, EMAIL, new).status_code == 200


def test_unknown_email_fails_exactly_like_a_wrong_code(client):
    _register(client)
    code = last_code(client, EMAIL)
    unknown = _verify(client, "nobody@geu.ac.in", code)
    wrong = _verify(client, EMAIL, _wrong(code))
    assert unknown.status_code == wrong.status_code == 400
    assert unknown.json() == wrong.json()


def test_a_guessed_code_never_reveals_an_existing_account(client):
    """Regression: verify-email used to return a verified user's profile for any code."""
    register(client, EMAIL, "Riya Sharma")
    r = _verify(client, EMAIL, "123456")
    assert r.status_code == 400
    assert "Riya" not in r.text


def test_resend_never_reveals_whether_an_account_exists(client):
    register(client, "verified@geu.ac.in")  # already an account
    _register(client)  # pending sign-up
    sent_before = len(client.app.state.mailer.outbox)
    for email in ("nobody@geu.ac.in", "verified@geu.ac.in", EMAIL):
        r = client.post("/auth/resend-verification", json={"email": email})
        assert r.status_code == 202, email
    sent = client.app.state.mailer.outbox[sent_before:]
    assert [m.to for m in sent] == [EMAIL]  # only the pending sign-up got mail


def test_resend_is_rate_limited_per_email(client):
    _register(client)
    for _ in range(3):
        client.post("/auth/resend-verification", json={"email": EMAIL})
    r = client.post("/auth/resend-verification", json={"email": EMAIL})
    assert r.status_code == 429


def test_verify_failures_are_rate_limited_per_ip(client):
    for i in range(4):
        _register(client, f"s{i}@geu.ac.in")
    attempts = [_verify(client, f"s{i % 4}@geu.ac.in", "000000") for i in range(21)]
    assert attempts[-1].status_code == 429


def test_codes_must_be_six_digits(client):
    for bad in ("12345", "1234567", "12a456", "      "):
        assert _verify(client, EMAIL, bad).status_code == 422


def test_expired_signups_are_swept_away(client, db):
    _register(client, "old@geu.ac.in")
    _register(client)
    db.execute(
        text(
            "UPDATE pending_registrations SET created_at = now() - interval '1 hour', "
            "expires_at = now() - interval '1 minute' WHERE email = 'old@geu.ac.in'"
        )
    )
    db.commit()
    result = client.portal.call(sweep, client.app.state.sessionmaker, client.app.state.hub)
    assert result.deleted_pending_signups == 1
    left = db.execute(text("SELECT email FROM pending_registrations")).scalars().all()
    assert left == [EMAIL]


def test_email_failure_is_reported_not_hidden(client):
    class Down:
        async def send(self, email):
            raise ConnectionError("smtp port blocked")

    client.app.state.mailer = Down()
    r = _register(client)
    assert r.status_code == 503
    assert "try again" in r.json()["detail"]
    r = client.post("/auth/resend-verification", json={"email": EMAIL})
    assert r.status_code == 503


def test_contacts_must_be_university_addresses(client):
    _, riya = signup(client, EMAIL)
    r = client.post("/contacts", json={"email": "mom@gmail.com"}, headers=riya)
    assert r.status_code == 422
    assert (
        client.post("/contacts", json={"email": "arjun@geu.ac.in"}, headers=riya).status_code == 202
    )


def test_verified_at_is_set_when_the_account_is_created(client, db):
    register(client, EMAIL)
    verified_at = db.execute(text("SELECT email_verified_at FROM users")).scalar_one()
    assert abs((verified_at - datetime.now(UTC)).total_seconds()) < 60
