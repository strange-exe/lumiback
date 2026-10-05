"""Share codes and guest tokens.

Codes: 10 Crockford base32 characters (~50 bits) from `secrets`, shown as XXXXX-XXXXX.
Stored as HMAC-SHA256(CODE_PEPPER, code). A fast keyed hash is appropriate because codes are
high-entropy and short-lived, and the pepper (not in the database) means a database leak alone
cannot be used to test guesses offline.
"""

import hashlib
import hmac
import secrets

ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"  # Crockford: no I, L, O, U
CODE_LENGTH = 10
# Crockford decoding is forgiving of look-alike characters people mistype.
_LOOKALIKES = str.maketrans({"O": "0", "I": "1", "L": "1"})


def new_code() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(CODE_LENGTH))


def display(code: str) -> str:
    return f"{code[:5]}-{code[5:]}"


def normalize(raw: str) -> str | None:
    """Canonical form of user input, or None if it cannot be a valid code."""
    code = raw.upper().replace("-", "").replace(" ", "").translate(_LOOKALIKES)
    if len(code) != CODE_LENGTH or any(c not in ALPHABET for c in code):
        return None
    return code


def hash_code(code: str, pepper: str) -> bytes:
    return hmac.new(pepper.encode(), code.encode(), hashlib.sha256).digest()


def new_guest_token() -> tuple[str, bytes]:
    token = secrets.token_urlsafe(32)
    return token, hash_guest_token(token)


def hash_guest_token(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()
