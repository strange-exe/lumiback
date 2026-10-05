"""Password hashing (Argon2id) and strength rules."""

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

MIN_LENGTH = 10
MAX_LENGTH = 128  # bounds hashing cost per request

# A small deny-list of the most common passwords that pass the length rule.
# (A breached-password check via k-anonymity can replace this before public launch.)
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
_DUMMY_HASH = _hasher.hash("timing-equalizer-not-a-password")


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
    """Constant-shape check: always runs one Argon2 verification."""
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)
