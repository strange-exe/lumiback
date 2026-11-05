"""Breached passwords: the HIBP range lookup (k-anonymity, padding, fail open) and where it runs."""

import asyncio
import hashlib
import logging

import httpx
import pytest
from sqlalchemy import text

from app.security.breached import (
    HibpBreachChecker,
    MemoryBreachChecker,
    make_breach_checker,
    split_hash,
)
from tests.helpers import PASSWORD, signup
from tests.test_password_reset import forgot, reset, reset_code

LEAKED = "summer-holidays-2024"  # passes the local rules; tests mark it breached
PREFIX, SUFFIX = split_hash(LEAKED)


def range_body(*rows: tuple[str, int]) -> str:
    # The real API ends lines with CRLF; padding rows have a count of 0.
    return "".join(f"{suffix}:{count}\r\n" for suffix, count in rows)


def checker(handler) -> HibpBreachChecker:
    return HibpBreachChecker(transport=httpx.MockTransport(handler))


# ---------- the range lookup ----------


def test_split_hash_is_upper_case_sha1_of_utf8():
    word = "p" + chr(0xE4) + "ssword-" + "".join(map(chr, (0x928, 0x92E, 0x938, 0x94D, 0x924)))
    digest = hashlib.sha1(word.encode("utf-8"), usedforsecurity=False).hexdigest()
    prefix, suffix = split_hash(word)
    assert prefix + suffix == digest.upper()
    assert (len(prefix), len(suffix)) == (5, 35)


def test_only_the_five_character_prefix_leaves_the_server_with_padding_asked_for():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, text=range_body(("0" * 35, 3)))

    assert asyncio.run(checker(handler).is_breached(LEAKED)) is False
    [request] = seen
    assert request.method == "GET"
    assert str(request.url) == f"https://api.pwnedpasswords.com/range/{PREFIX}"
    assert request.headers["Add-Padding"] == "true"
    assert request.headers["User-Agent"]
    sent = str(request.url) + "".join(f"{k}:{v}" for k, v in request.headers.items())
    assert SUFFIX not in sent and SUFFIX.lower() not in sent
    assert LEAKED not in sent
    assert request.content == b""


def test_a_listed_suffix_is_breached_case_insensitively():
    body = range_body(("A" * 35, 0), (SUFFIX.lower(), 42), ("B" * 35, 7))
    assert asyncio.run(checker(lambda _: httpx.Response(200, text=body)).is_breached(LEAKED))


def test_padding_rows_never_count_as_breached():
    body = range_body((SUFFIX, 0), ("B" * 35, 7))
    hit = checker(lambda _: httpx.Response(200, text=body)).is_breached(LEAKED)
    assert asyncio.run(hit) is False


def test_an_unlisted_suffix_is_not_breached():
    body = range_body(("A" * 35, 12), ("B" * 35, 7))
    hit = checker(lambda _: httpx.Response(200, text=body)).is_breached(LEAKED)
    assert asyncio.run(hit) is False


@pytest.mark.parametrize(
    "failure",
    [
        lambda _: httpx.Response(503, text="down"),
        lambda _: httpx.Response(429, text="slow down"),
        lambda r: (_ for _ in ()).throw(httpx.ConnectError("no route", request=r)),
        lambda r: (_ for _ in ()).throw(httpx.ReadTimeout("slow", request=r)),
    ],
    ids=["503", "429", "connect-error", "read-timeout"],
)
def test_an_unreachable_api_fails_open_with_a_log_line(failure, caplog):
    with caplog.at_level(logging.WARNING, logger="app.security.breached"):
        assert asyncio.run(checker(failure).is_breached(LEAKED)) is False
    [record] = caplog.records
    assert "skipped" in record.getMessage()
    assert PREFIX not in record.getMessage() and LEAKED not in record.getMessage()


def test_a_slow_api_is_cut_off_at_the_timeout_and_fails_open(caplog):
    async def handler(_: httpx.Request) -> httpx.Response:
        await asyncio.sleep(5)
        return httpx.Response(200, text=range_body((SUFFIX, 9)))

    slow = HibpBreachChecker(transport=httpx.MockTransport(handler), timeout=0.05)

    async def timed() -> tuple[bool, float]:
        loop = asyncio.get_running_loop()
        start = loop.time()
        result = await slow.is_breached(LEAKED)
        return result, loop.time() - start

    with caplog.at_level(logging.WARNING, logger="app.security.breached"):
        result, elapsed = asyncio.run(timed())
    assert result is False
    assert elapsed < 1
    assert "skipped" in caplog.text


def test_the_setting_picks_the_checker():
    assert isinstance(make_breach_checker("hibp"), HibpBreachChecker)
    off = make_breach_checker("off")
    assert isinstance(off, MemoryBreachChecker)
    assert asyncio.run(off.is_breached(LEAKED)) is False


# ---------- where it runs ----------


def test_register_refuses_a_breached_password_and_keeps_nothing(client, db, breaches):
    breaches.breached.add(LEAKED)
    r = client.post(
        "/auth/register", json={"name": "Riya", "email": "riya@example.com", "password": LEAKED}
    )
    assert r.status_code == 422
    assert r.json()["detail"] == "Password was found in a data breach. Choose a different one"
    assert LEAKED not in r.text
    assert db.execute(text("SELECT count(*) FROM pending_registrations")).scalar_one() == 0
    assert client.app.state.mailer.outbox == []


def test_register_accepts_a_password_not_in_any_breach(client, breaches):
    breaches.breached.add(LEAKED)
    r = client.post(
        "/auth/register", json={"name": "Riya", "email": "riya@example.com", "password": PASSWORD}
    )
    assert r.status_code == 202, r.text
    assert breaches.checked == [PASSWORD]


def test_register_skips_the_lookup_when_the_local_rules_already_refuse(client, breaches):
    r = client.post(
        "/auth/register",
        json={"name": "Riya", "email": "riya@example.com", "password": "password123"},
    )
    assert r.status_code == 422
    assert breaches.checked == []  # the deny-list is the offline floor, checked first


def test_register_still_works_when_the_api_is_down(client):
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route", request=request)

    client.app.state.breaches = checker(down)
    r = client.post(
        "/auth/register", json={"name": "Riya", "email": "riya@example.com", "password": LEAKED}
    )
    assert r.status_code == 202, r.text


def test_reset_refuses_a_breached_password_without_using_up_the_code(client, breaches):
    signup(client, "riya@example.com", "Riya Sharma")
    forgot(client, "riya@example.com")
    code = reset_code(client, "riya@example.com")
    breaches.breached.add(LEAKED)
    for _ in range(6):  # more than the 5 tries a code allows: none of these used one up
        r = reset(client, "riya@example.com", code, LEAKED)
        assert r.status_code == 422
        assert r.json()["detail"] == "Password was found in a data breach. Choose a different one"
    assert reset(client, "riya@example.com", code).status_code == 204


def test_reset_with_a_wrong_code_never_looks_the_password_up(client, breaches):
    signup(client, "riya@example.com", "Riya Sharma")
    forgot(client, "riya@example.com")
    code = reset_code(client, "riya@example.com")
    wrong = "000000" if code != "000000" else "111111"
    breaches.checked.clear()  # signing up checked the first password
    assert reset(client, "riya@example.com", wrong, LEAKED).status_code == 400
    assert breaches.checked == []
