"""Verification email: content, escaping, and the MIME structure actually sent."""

import asyncio
import json
from datetime import UTC, datetime
from html import escape
from types import SimpleNamespace

import httpx
import pytest
from pydantic import SecretStr

from app.email import Email, ResendMailer, build_message
from app.email_templates import (
    NOTICE_HTML,
    escalation_email,
    ist_stamp,
    late_alert_email,
    notice_email,
    password_reset_email,
    request_decision_email,
    request_decision_notice,
    set_reply_to,
    verification_email,
)

REQUESTED = datetime(2026, 10, 6, 17, 11, tzinfo=UTC)  # 10:41 PM IST


def make(name: str = "Riya Sharma", to: str = "riya@geu.ac.in") -> Email:
    return verification_email(to=to, name=name, code="048291", minutes=15, requested_at=REQUESTED)


def test_code_is_in_subject_and_body():
    email = make()
    assert email.subject == "048291 is your Lumiback code"  # readable from the notification
    assert "Your Lumiback verification code is 048291." in email.body
    assert "expires in 15 minutes" in email.body.lower()


def test_code_email_is_text_plus_inbox_tested_html():
    """This HTML passed the GEU Microsoft 365 inbox test (2026-10-08); text stays first."""
    email = make()
    assert email.html is not None
    assert build_message(email, "x@y.z").get_content_type() == "multipart/alternative"
    # Same words in both parts, and the traits the inbox test passed with.
    assert "048291" in email.html
    assert "Your Lumiback verification code is" in email.html
    assert "Lumiback will never ask for this code" in email.html
    for risky in ("<img", "<a ", "href=", "<style", "display:none"):
        assert risky not in email.html


def test_html_escapes_what_people_typed():
    email = make(name="<b>Riya</b> Sharma", to="riya@geu.ac.in")
    assert "<b>Riya</b>" not in (email.html or "")
    assert "&lt;b&gt;Riya&lt;/b&gt;" in (email.html or "")


def test_password_reset_email_matches_the_code_email():
    email = password_reset_email(
        to="riya@geu.ac.in", name="Riya", code="112233", minutes=15, requested_at=REQUESTED
    )
    assert email.subject == "112233 is your Lumiback code"
    assert "Your Lumiback password reset code is 112233." in email.body
    assert email.html is not None and "Reset your password" in email.html


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


def _resend_mailer(handler, reply_to: str | None = None) -> ResendMailer:
    settings = SimpleNamespace(
        resend_api_key=SecretStr("re_test_key"),
        email_from="Lumiback <no-reply@example.com>",
        email_reply_to=reply_to,
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
    assert "048291" in seen["body"]["html"]  # the HTML version travels alongside the text


def test_resend_mailer_raises_when_resend_refuses():
    def refuse(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"message": "domain not verified"})

    with pytest.raises(RuntimeError, match="403"):
        asyncio.run(_resend_mailer(refuse).send(make()))


# ---------- replies ----------


@pytest.fixture
def replies():
    set_reply_to("support@lumiback.test")
    yield "support@lumiback.test"
    set_reply_to(None)


def test_reply_to_header_only_when_configured():
    plain = build_message(make(), "x@y.z")
    assert plain["Reply-To"] is None
    message = build_message(make(), "x@y.z", "support@lumiback.test")
    assert message["Reply-To"] == "support@lumiback.test"


def test_resend_mailer_sends_reply_to_when_configured():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.setdefault("bodies", []).append(json.loads(request.content))
        return httpx.Response(200, json={"id": "abc"})

    asyncio.run(_resend_mailer(handler).send(make()))
    asyncio.run(_resend_mailer(handler, "support@lumiback.test").send(make()))
    first, second = seen["bodies"]
    assert "reply_to" not in first
    assert second["reply_to"] == "support@lumiback.test"


def test_emails_invite_replies_only_when_they_can_arrive(replies):
    email = make()
    assert "Reply to this email" in email.body and "Reply to this email" in (email.html or "")
    set_reply_to(None)
    email = make()
    assert "Reply to this email" not in email.body
    assert "Reply to this email" not in (email.html or "")


# ---------- notices ----------

WEB = "https://lumiback.test"
DUE = datetime(2026, 10, 9, 14, 30, tzinfo=UTC)  # 8:00 PM IST


def test_late_alert_says_when_and_where_to_answer():
    email = late_alert_email(to="riya@geu.ac.in", name="Riya Sharma", due_at=DUE, web_url=WEB)
    assert email.subject == "Lumiback: are you OK? You're 30 minutes past your return time"
    assert email.body.startswith("Hi Riya,")
    assert "You were due back at 8:00 PM" in email.body
    assert "Answer now: https://lumiback.test/home" in email.body
    assert "within 10 minutes" in email.body


def test_notices_are_plain_text_until_their_inbox_test_passes():
    assert NOTICE_HTML is False
    email = late_alert_email(to="riya@geu.ac.in", name="Riya", due_at=DUE, web_url=WEB)
    assert email.html is None


@pytest.mark.parametrize("link", ["button", "text"])
def test_notice_html_has_the_same_words_and_one_link(link):
    notice = request_decision_notice(
        to="riya@geu.ac.in", name="Riya", approved=False, note="<b>Exams</b>", web_url=WEB
    )
    email = notice_email(notice, html=True, link=link)
    html = email.html or ""
    for words in ("Hi Riya,", "Declined", "Today's outing request was declined"):
        assert words in email.body
        assert escape(words) in html
    assert "&lt;b&gt;Exams&lt;/b&gt;" in html and "<b>Exams</b>" not in html
    assert html.count("href=") == 1 and 'href="https://lumiback.test/home"' in html
    for risky in ("<img", "<style", "display:none"):
        assert risky not in html


def test_approval_and_decline_read_differently():
    ok = request_decision_email(
        to="r@geu.ac.in", name="Riya", approved=True, note=None, web_url=WEB
    )
    no = request_decision_email(
        to="r@geu.ac.in", name="Riya", approved=False, note=None, web_url=WEB
    )
    assert ok.subject == "Lumiback: your outing request is approved"
    assert "Tap out at the gate" in ok.body
    assert no.subject == "Lumiback: your outing request was declined"
    assert "note" not in no.body.lower()


def test_escalation_email_points_to_the_page_without_student_details():
    email = escalation_email(to="warden@geu.ac.in", count=2, web_url=WEB)
    assert email.subject == "Lumiback: 2 late student(s) not answering"
    assert "2 late students aren't answering" in email.body
    assert "https://lumiback.test/admin/escalations" in email.body
    one = escalation_email(to="warden@geu.ac.in", count=1, web_url=WEB)
    assert "1 late student isn't answering" in one.body
