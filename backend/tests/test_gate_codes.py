"""Rotating gate codes: valid only for their gate, briefly, and only with the server pepper."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.security.gate_codes import (
    ACCEPT_WINDOWS,
    WINDOW_SECONDS,
    code_is_valid,
    gate_code,
    hash_kiosk_token,
    new_kiosk_token,
    parse_qr,
    qr_payload,
    window_at,
)

PEPPER = "test-pepper-" + "x" * 40
GATE = uuid.UUID("3f2b6c1e-8a4d-4f0e-9b7a-2c5d1e6f7a8b")
NOW = datetime(2026, 10, 8, 18, 30, 7, tzinfo=UTC)


def test_code_shape_and_determinism():
    code = gate_code(PEPPER, GATE, 123)
    assert len(code) == 10 and code.isalnum() and code == code.upper()
    assert gate_code(PEPPER, GATE, 123) == code
    assert gate_code(PEPPER, GATE, 124) != code  # rotates
    assert gate_code(PEPPER, uuid.uuid4(), 123) != code  # per gate
    assert gate_code("another-pepper-" + "y" * 40, GATE, 123) != code  # needs the server secret


def test_accepted_for_the_current_and_recent_windows_only():
    w = window_at(NOW)
    for age in range(ACCEPT_WINDOWS):
        assert code_is_valid(PEPPER, GATE, w - age, gate_code(PEPPER, GATE, w - age), NOW)
    old = w - ACCEPT_WINDOWS
    assert not code_is_valid(PEPPER, GATE, old, gate_code(PEPPER, GATE, old), NOW)
    future = w + 1  # a kiosk clock running ahead must not mint codes
    assert not code_is_valid(PEPPER, GATE, future, gate_code(PEPPER, GATE, future), NOW)


def test_a_photo_stops_working_after_about_a_minute():
    w = window_at(NOW)
    code = gate_code(PEPPER, GATE, w)
    later = NOW + timedelta(seconds=WINDOW_SECONDS * ACCEPT_WINDOWS)
    assert not code_is_valid(PEPPER, GATE, w, code, later)


def test_wrong_code_or_gate_is_rejected():
    w = window_at(NOW)
    assert not code_is_valid(PEPPER, GATE, w, "0000000000", NOW)
    assert not code_is_valid(PEPPER, uuid.uuid4(), w, gate_code(PEPPER, GATE, w), NOW)


@pytest.mark.parametrize(
    "text",
    [
        "https://lumiback.abhinesh.codes/g/{gate}.{w}.{code}",
        "https://lumiback.abhinesh.codes/g/{gate}.{w}.{code}?utm=x",
        "{gate}.{w}.{code}",
        "  {gate}.{w}.{lower}  ",
    ],
)
def test_parse_accepts_the_url_and_the_bare_payload(text):
    w = window_at(NOW)
    code = gate_code(PEPPER, GATE, w)
    parsed = parse_qr(text.format(gate=GATE, w=w, code=code, lower=code.lower()))
    assert parsed == (GATE, w, code)


@pytest.mark.parametrize(
    "text", ["", "hello", "https://example.com/g/not-a-uuid.1.ABCDEFGHJK", f"{GATE}.12.SHORT"]
)
def test_parse_rejects_anything_else(text):
    assert parse_qr(text) is None


def test_payload_round_trips():
    w = window_at(NOW)
    code = gate_code(PEPPER, GATE, w)
    assert parse_qr(qr_payload("https://lumiback.abhinesh.codes/", GATE, w, code)) == (
        GATE,
        w,
        code,
    )


def test_kiosk_tokens_are_random_and_stored_hashed():
    token, digest = new_kiosk_token()
    assert len(token) >= 40 and len(digest) == 32
    assert hash_kiosk_token(token) == digest
    assert new_kiosk_token()[0] != token
