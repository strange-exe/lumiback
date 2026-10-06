"""Verification email: content, escaping, and the MIME structure actually sent."""

import asyncio
import json
from datetime import UTC, datetime
from types import SimpleNamespace

import httpx
import pytest
from pydantic import SecretStr

from app.email import Email, ResendMailer, build_message
from app.email_templates import ist_stamp, verification_email

REQUESTED = datetime(2026, 10, 6, 17, 11, tzinfo=UTC)  # 10:41 PM IST


def make(name: str = "Riya Sharma", to: str = "riya@geu.ac.in") -> Email:
    return verification_email(to=to, name=name, code="048291", minutes=15, requested_at=REQUESTED)


def test_code_is_in_subject_and_body():
    email = make()
    assert email.subject == "048291 is your Lumiback code"  # readable from the notification
    assert "Your Lumiback verification code is 048291." in email.body
    assert "expires in 15 minutes" in email.body.lower()


def test_code_email_is_plain_text_only():
    """HTML versions landed in GEU's Outlook Junk; plain text reached the Inbox (2026-10-06)."""
    email = make()
    assert email.html is None
    assert build_message(email, "x@y.z").get_content_type() == "text/plain"


def test_request_time_is_shown_in_ist():
    assert "10:41 PM IST, Tue 6 Oct" in make().body


def test_ist_stamp_handles_midnight_and_noon():
    assert ist_stamp(datetime(2026, 10, 5, 18, 30, tzinfo=UTC)) == "12:00 AM IST, Tue 6 Oct"
    assert ist_stamp(datetime(2026, 10, 6, 6, 30, tzinfo=UTC)) == "12:00 PM IST, Tue 6 Oct"


def test_warns_never_to_share_the_code():
    assert "never ask for this code" in make().body


def test_greets_by_first_name():
    assert make("Riya Sharma").body.startswith("Hi Riya,")


def test_blank_name_falls_back_gracefully():
    assert make("   ").body.startswith("Hi there,")


def test_no_links_in_code_email():
    """Spam filters distrust links in verification mail."""
    body = make().body
    assert "http://" not in body and "https://" not in body


def test_html_email_is_multipart_with_text_first():
    email = Email(to="a@geu.ac.in", subject="s", body="hello", html="<p>hello</p>")
    message = build_message(email, "Lumiback <no-reply@outing.example.com>")
    assert message.get_content_type() == "multipart/alternative"
    parts = [part.get_content_type() for part in message.iter_parts()]
    assert parts == ["text/plain", "text/html"]  # clients show the last part they support
    assert message["From"] == "Lumiback <no-reply@outing.example.com>"


def test_text_only_email_stays_single_part():
    message = build_message(Email(to="a@geu.ac.in", subject="s", body="hello"), "x@y.z")
    assert message.get_content_type() == "text/plain"


def _resend_mailer(handler) -> ResendMailer:
    settings = SimpleNamespace(
        resend_api_key=SecretStr("re_test_key"), email_from="Lumiback <no-reply@example.com>"
    )
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return ResendMailer(settings, client=client)  # type: ignore[arg-type]


def test_resend_mailer_posts_the_email_over_https():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"id": "abc"})

    asyncio.run(_resend_mailer(handler).send(make()))
    assert seen["url"] == "https://api.resend.com/emails"
    assert seen["auth"] == "Bearer re_test_key"
    assert seen["body"]["to"] == ["riya@geu.ac.in"]
    assert seen["body"]["subject"] == "048291 is your Lumiback code"
    assert "048291" in seen["body"]["text"]
    assert "html" not in seen["body"]  # codes go out as plain text


def test_resend_mailer_raises_when_resend_refuses():
    def refuse(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"message": "domain not verified"})

    with pytest.raises(RuntimeError, match="403"):
        asyncio.run(_resend_mailer(refuse).send(make()))
