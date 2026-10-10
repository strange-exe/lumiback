"""Rotating gate QR codes and kiosk device tokens.

A gate kiosk shows a QR that changes every WINDOW_SECONDS. Its code is
HMAC(pepper, "gate:{gate_id}:{window}") cut to 10 Crockford base32 characters (50 bits), so
nobody can produce a valid code without the server's pepper, and a photo of the QR stops working
after ACCEPT_WINDOWS windows (about a minute). That limits a forwarded photo; the GPS check at
scan time stops the rest.

QR content is a URL on the web app (`/g/<gate>.<window>.<code>`): a phone camera opens a page
that says "scan with the Lumiback app", and the app's scanner parses the same string.

Kiosk tokens are long random secrets given to a kiosk once; only their SHA-256 is stored.
"""

import hashlib
import hmac
import re
import secrets
import uuid
from datetime import datetime

from app.security.codes import ALPHABET

WINDOW_SECONDS = 20
# The current window and the two before it: time to scan and send it on a slow network.
ACCEPT_WINDOWS = 3
CODE_LENGTH = 10

_QR = re.compile(
    r"(?:^|/g/)(?P<gate>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"
    r"\.(?P<window>\d{1,12})\.(?P<code>[0-9A-Z]{10})(?:$|[?#])",
    re.IGNORECASE,
)


def window_at(now: datetime) -> int:
    return int(now.timestamp()) // WINDOW_SECONDS


def window_ends_at(window: int) -> int:
    """Epoch seconds when this window's code stops being the current one."""
    return (window + 1) * WINDOW_SECONDS


def gate_code(pepper: str, gate_id: uuid.UUID, window: int) -> str:
    digest = hmac.new(pepper.encode(), f"gate:{gate_id}:{window}".encode(), hashlib.sha256).digest()
    number = int.from_bytes(digest[:8], "big")
    chars = []
    for _ in range(CODE_LENGTH):
        number, index = divmod(number, len(ALPHABET))
        chars.append(ALPHABET[index])
    return "".join(chars)


def qr_payload(web_url: str, gate_id: uuid.UUID, window: int, code: str) -> str:
    return f"{web_url.rstrip('/')}/g/{gate_id}.{window}.{code}"


def parse_qr(text: str) -> tuple[uuid.UUID, int, str] | None:
    """(gate_id, window, code) from a scanned QR (full URL or the bare triple), else None."""
    match = _QR.search(text.strip())
    if not match:
        return None
    return uuid.UUID(match["gate"]), int(match["window"]), match["code"].upper()


def code_is_valid(pepper: str, gate_id: uuid.UUID, window: int, code: str, now: datetime) -> bool:
    current = window_at(now)
    if not current - ACCEPT_WINDOWS < window <= current:
        return False
    return hmac.compare_digest(gate_code(pepper, gate_id, window), code.upper())


def new_kiosk_token() -> tuple[str, bytes]:
    token = secrets.token_urlsafe(32)
    return token, hash_kiosk_token(token)


def hash_kiosk_token(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()
