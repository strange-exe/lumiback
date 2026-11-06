"""Access tokens (short-lived JWT) and refresh tokens (opaque, stored hashed)."""

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt

ACCESS_TTL = timedelta(minutes=15)
REFRESH_TTL = timedelta(days=30)
ALGORITHM = "HS256"
ISSUER = "outing-api"
LEEWAY_SECONDS = 10


class InvalidToken(Exception):
    """Raised for any malformed, expired, or wrongly-typed token. Callers return 401."""


@dataclass(frozen=True)
class AccessClaims:
    user_id: uuid.UUID
    expires_at: datetime
    # The sign-in (refresh-token family) it came from; None for tokens issued before
    # 2026-11-07, which simply expire.
    session_id: uuid.UUID | None = None


def create_access_token(
    user_id: uuid.UUID,
    secret: str,
    *,
    session_id: uuid.UUID | None = None,
    now: datetime | None = None,
) -> str:
    now = now or datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "typ": "access",
        "iss": ISSUER,
        "iat": now,
        "exp": now + ACCESS_TTL,
        "jti": secrets.token_hex(8),
    }
    if session_id is not None:
        payload["sid"] = str(session_id)
    return jwt.encode(payload, secret, algorithm=ALGORITHM)


def decode_access_token(token: str, secret: str) -> AccessClaims:
    try:
        payload = jwt.decode(
            token,
            secret,
            algorithms=[ALGORITHM],  # pinned: never trust the token's own "alg" header
            issuer=ISSUER,
            leeway=LEEWAY_SECONDS,
            options={"require": ["sub", "typ", "iss", "iat", "exp"]},
        )
        if payload["typ"] != "access":
            raise InvalidToken("wrong token type")
        sid = payload.get("sid")
        return AccessClaims(
            user_id=uuid.UUID(payload["sub"]),
            expires_at=datetime.fromtimestamp(payload["exp"], UTC),
            session_id=uuid.UUID(sid) if isinstance(sid, str) else None,
        )
    except (jwt.PyJWTError, ValueError, KeyError) as e:
        raise InvalidToken(str(e)) from None


def new_refresh_token() -> tuple[str, bytes]:
    """Return (plaintext for the client, SHA-256 digest for the database).

    A fast hash is appropriate: the token has 256 bits of entropy, so it cannot be guessed,
    and hashing only ensures a database leak does not hand out usable tokens.
    """
    token = secrets.token_urlsafe(32)
    return token, hash_refresh_token(token)


def hash_refresh_token(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()
