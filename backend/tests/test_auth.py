"""Auth: registration rules, login, token validation, refresh rotation (A10), limits (A12)."""

import hashlib
import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from pydantic import ValidationError
from sqlalchemy import text

from app.schemas import ContactsIn, HostelContactIn, HostelIn
from app.security.tokens import create_access_token
from tests.conftest import FAKE_SECRET
from tests.helpers import PASSWORD, auth_header, login, register

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


@pytest.mark.parametrize(
    "name",
    [
        "Riya" + chr(13) + chr(10) + "Bcc: x@example.com",  # CR LF: a header in an email subject
        "Riya" + chr(10) + "Sharma",
        "Riya" + chr(13),  # even at the end, where stripping would hide it
        "Riya" + chr(0) + "Sharma",
        "Riya" + chr(9) + "Sharma",  # a tab is a control character too
        "Riya" + chr(0x7F),
        "Riya" + chr(0x85) + "Sharma",  # NEL: a C1 line break
        "Riya " + chr(0x202E) + "amrahS",  # right-to-left override (Cf)
        "Riya" + chr(0x200B) + "Sharma",  # zero-width space (Cf)
        chr(0xFEFF) + "Riya",  # byte-order mark (Cf)
    ],
)
def test_register_refuses_control_and_format_characters_in_the_name(client, db, name):
    r = client.post(
        "/auth/register", json={"name": name, "email": "riya@example.com", "password": PASSWORD}
    )
    assert r.status_code == 422, r.text
    assert db.execute(text("SELECT count(*) FROM pending_registrations")).scalar_one() == 0


@pytest.mark.parametrize(
    "name",
    [
        "Riya" + chr(0x2028) + "Sharma",  # line separator (Zl): a line break in a greeting
        "Riya" + chr(0x2029) + "Sharma",  # paragraph separator (Zp)
        chr(0x200D) + chr(0x200C),  # only joiners: allowed inside a name, never a name alone
        chr(0x3164),  # Hangul filler: a "letter" that shows nothing
        chr(0x115F) + chr(0x3164),  # Hangul choseong filler + filler
        chr(0x3164) + " " + chr(0x200D),
        "-'.",  # no letter or digit at all
    ],
)
def test_register_refuses_names_that_break_lines_or_show_nothing(client, db, name):
    r = client.post(
        "/auth/register", json={"name": name, "email": "riya@example.com", "password": PASSWORD}
    )
    assert r.status_code == 422, r.text
    assert db.execute(text("SELECT count(*) FROM pending_registrations")).scalar_one() == 0


PERSON_NAME_REFUSED = [
    "Sunita" + chr(13) + chr(10) + "Bcc: x@example.com",
    "Sunita" + chr(0x202E) + "amrahS",
    "Sunita" + chr(0x200B) + "Sharma",
    "Sunita" + chr(0x2028) + "Sharma",
    chr(0x200D),
    chr(0x3164),
    chr(0x115F),
]
RELATION_REFUSED = [
    "Mother" + chr(10) + "Bcc: x@example.com",
    "Mother" + chr(0x202E),
    chr(0xFEFF) + "Mother",
    "Mo" + chr(0x2029) + "ther",
]
CONTACTS_OK = {
    "phone": "9876543210",
    "emergency_name": "Sunita Sharma",
    "emergency_relation": "Mother",
    "emergency_phone": "9123456789",
}


@pytest.mark.parametrize("name", PERSON_NAME_REFUSED)
def test_emergency_and_warden_names_refuse_control_format_and_empty_looking_text(name):
    with pytest.raises(ValidationError):
        ContactsIn(**{**CONTACTS_OK, "emergency_name": name})
    with pytest.raises(ValidationError):
        HostelContactIn(warden_name=name)
    with pytest.raises(ValidationError):
        HostelIn(name="Hostel A", rule_set_id=uuid.uuid4(), warden_name=name)


@pytest.mark.parametrize("relation", RELATION_REFUSED)
def test_the_emergency_relation_refuses_control_and_format_characters(relation):
    with pytest.raises(ValidationError):
        ContactsIn(**{**CONTACTS_OK, "emergency_relation": relation})


def test_person_names_keep_any_script_and_the_joiners():
    malayalam = "".join(map(chr, (0xD28, 0xD3F, 0xD24, 0xD4D, 0x200D, 0xD2F)))
    contacts = ContactsIn(
        **{**CONTACTS_OK, "emergency_name": f"  {malayalam} ", "emergency_relation": "Guardian"}
    )
    assert contacts.emergency_name == malayalam
    assert HostelContactIn(warden_name="Mr. D'Souza").warden_name == "Mr. D'Souza"


def test_register_keeps_names_in_any_script(client):
    hindi = "".join(map(chr, (0x930, 0x93F, 0x92F, 0x93E)))  # a Devanagari name, with its marks
    user = register(client, "riya@example.com", f"Riya {hindi} D'Souza-Verma")
    assert user["name"] == f"Riya {hindi} D'Souza-Verma"


def test_register_keeps_the_zero_width_joiners_indic_names_use(client):
    # Malayalam and Devanagari spell some names with ZWJ (U+200D) or ZWNJ (U+200C); both are
    # format characters, but they are part of the name, so they are allowed.
    malayalam = "".join(map(chr, (0xD28, 0xD3F, 0xD24, 0xD4D, 0x200D, 0xD2F)))
    hindi = "".join(map(chr, (0x915, 0x94D, 0x200C, 0x937)))
    for i, name in enumerate((malayalam, hindi)):
        user = register(client, f"joiner{i}@example.com", name)
        assert user["name"] == name


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

    clock.advance(15 * 60 + 1)  # window passes
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
