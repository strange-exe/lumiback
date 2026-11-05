"""Breached-password check with Have I Been Pwned's Pwned Passwords range API.

k-anonymity: only the first 5 hex characters of the password's SHA-1 leave the server. The
API answers with every known suffix under that prefix, and the match is made here. With
Add-Padding the reply also carries 800-1,000 fake suffixes with a count of 0, so its size
doesn't hint at the prefix. Docs: https://haveibeenpwned.com/API/v3#PwnedPasswords

The check fails open: if the API is slow or down, the password is accepted (the local
deny-list in passwords.py still applies) and a warning is logged. Sign-up and password reset
must not depend on a third party being up.
"""

import asyncio
import hashlib
import logging
from dataclasses import dataclass, field
from typing import Protocol

import httpx

logger = logging.getLogger(__name__)

RANGE_URL = "https://api.pwnedpasswords.com/range/"
# Whole-request budget, connect included. The API is normally well under 200 ms (Cloudflare).
TIMEOUT_SECONDS = 2.0
HEADERS = {"Add-Padding": "true", "User-Agent": "Lumiback-API"}

# Completes "Password ..." / "password ..." like the other password_problem() reasons.
BREACHED = "was found in a data breach. Choose a different one"


class BreachChecker(Protocol):
    async def is_breached(self, password: str) -> bool: ...


def split_hash(password: str) -> tuple[str, str]:
    """SHA-1 of the UTF-8 password, upper-case hex, as (5-char prefix, 35-char suffix)."""
    digest = hashlib.sha1(password.encode("utf-8"), usedforsecurity=False).hexdigest().upper()
    return digest[:5], digest[5:]


def suffix_listed(body: str, suffix: str) -> bool:
    """True if `suffix` is in a range reply with a count above 0 (padding rows have 0)."""
    for line in body.splitlines():
        candidate, _, count = line.strip().partition(":")
        if candidate.upper() == suffix:
            try:
                return int(count) > 0
            except ValueError:
                return False
    return False


class HibpBreachChecker:
    def __init__(
        self,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout: float = TIMEOUT_SECONDS,
    ) -> None:
        self._transport = transport
        self._timeout = timeout

    async def is_breached(self, password: str) -> bool:
        prefix, suffix = split_hash(password)
        try:
            async with asyncio.timeout(self._timeout):
                async with httpx.AsyncClient(
                    timeout=self._timeout, transport=self._transport
                ) as client:
                    response = await client.get(RANGE_URL + prefix, headers=HEADERS)
                    response.raise_for_status()
                    body = response.text
        except (httpx.HTTPError, TimeoutError) as e:
            # Never log the prefix or the password: just that the check was skipped, and why.
            logger.warning("breached-password check skipped (fail open): %s", type(e).__name__)
            return False
        return suffix_listed(body, suffix)


class OffBreachChecker:
    """BREACH_CHECK=off (offline e2e runs): every password passes the lookup (the local rules
    in passwords.py still apply). Keeps nothing: no state at all, so no password lingers."""

    __slots__ = ()

    async def is_breached(self, password: str) -> bool:
        return False


def make_breach_checker(breach_check: str) -> BreachChecker:
    return HibpBreachChecker() if breach_check == "hibp" else OffBreachChecker()


@dataclass
class MemoryBreachChecker:
    """Tests only, injected explicitly (tests/conftest.py `breaches`): a fixed set of
    'breached' passwords, no network, and a record of every password checked."""

    breached: set[str] = field(default_factory=set)
    checked: list[str] = field(default_factory=list)

    async def is_breached(self, password: str) -> bool:
        self.checked.append(password)
        return password in self.breached
