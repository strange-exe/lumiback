"""Password hashing (Argon2id) and strength rules."""

import asyncio

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

MIN_LENGTH = 10
MAX_LENGTH = 128  # bounds hashing cost per request

# A small deny-list of the most common passwords that pass the length rule.
# It stays as the offline floor: the breached-password check (security/breached.py) fails open.
COMMON = frozenset(
    {
        "1234567890",
        "12345678910",
        "123456789a",
        "0987654321",
        "1q2w3e4r5t",
        "qwertyuiop",
        "password12",
        "password123",
        "password1234",
        "iloveyou123",
        "abcdefghij",
        "qwerty12345",
        "1qaz2wsx3edc",
        "letmein1234",
        "welcome123",
        "admin12345",
        "graphicera",
        "graphicera123",
    }
)

_hasher = PasswordHasher()  # argon2-cffi defaults follow RFC 9106 (Argon2id)
# Verifying against this when the user does not exist keeps login timing uniform,
# so response time does not reveal whether an email is registered.
# Precomputed (it was `_hasher.hash(...)` at import: ~60 ms of CPU and 64 MiB on every cold start).
# Verify time depends only on the parameters inside the hash string, so a stored hash with the
# hasher's own parameters costs exactly what a fresh one would. It is the hash of a non-secret
# phrase and never authenticates anyone (verify_password returns False whenever it is used).
# tests/test_passwords.py fails if argon2-cffi's defaults ever move away from these parameters.
_DUMMY_PASSWORD = "timing-equalizer-not-a-password"  # noqa: S105 (not a credential)
_DUMMY_HASH = (
    "$argon2id$v=19$m=65536,t=3,p=4"
    "$/Xb2I/N3FHUBWaxVRtuwWg$SoYr8oGqDPi7c3i3i1Osni0mfJEM2WYYStjA8veK75k"
)


def password_problem(password: str, *, email: str = "", name: str = "") -> str | None:
    """Return a human-readable reason the password is unacceptable, or None."""
    if len(password) < MIN_LENGTH:
        return f"must be at least {MIN_LENGTH} characters"
    if len(password) > MAX_LENGTH:
        return f"must be at most {MAX_LENGTH} characters"
    lowered = password.lower()
    if lowered in COMMON or len(set(lowered)) < 4:
        return "is too common"
    local = email.split("@", 1)[0].lower()
    if (len(local) >= 4 and local in lowered) or (len(name) >= 4 and name.lower() in lowered):
        return "must not contain your name or email"
    return None


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    """Constant-shape check: always runs one Argon2 verification.

    A missing hash, or a marker such as "no password set yet", is checked against a dummy
    hash, so it takes as long as a wrong password and never says which accounts lack one.
    """
    real = password_hash is not None and password_hash.startswith("$argon2")
    try:
        ok = _hasher.verify(password_hash if real else _DUMMY_HASH, password)
    except (VerificationError, InvalidHashError):
        return False
    return ok and real


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


# Argon2 takes tens of milliseconds of CPU on purpose. The app calls these, so that work runs in
# a thread and never stalls the event loop (every other request on the worker) while it runs.


async def hash_password_async(password: str) -> str:
    return await asyncio.to_thread(hash_password, password)


async def verify_password_async(password_hash: str | None, password: str) -> bool:
    return await asyncio.to_thread(verify_password, password_hash, password)
