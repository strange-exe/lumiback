"""Verification email: content, escaping, and the MIME structure actually sent."""

from datetime import UTC, datetime

from app.email import Email, build_message
from app.email_templates import ist_stamp, verification_email

REQUESTED = datetime(2026, 10, 6, 17, 11, tzinfo=UTC)  # 10:41 PM IST


def make(name: str = "Riya Sharma", to: str = "riya@geu.ac.in") -> Email:
    return verification_email(to=to, name=name, code="048291", minutes=15, requested_at=REQUESTED)


def test_code_is_in_subject_text_and_html():
    email = make()
    assert email.subject == "048291 is your Lumiback code"  # readable from the notification
    assert "Your Lumiback verification code is 048291." in email.body
    assert email.html is not None and ">048291</td>" in email.html
    assert "expires in 15 minutes" in email.body.lower()
    assert "expires in 15 minutes" in email.html.lower()


def test_request_time_is_shown_in_ist():
    email = make()
    assert "10:41 PM IST, Tue 6 Oct" in email.body
    assert "10:41 PM IST, Tue 6 Oct" in (email.html or "")


def test_ist_stamp_handles_midnight_and_noon():
    assert ist_stamp(datetime(2026, 10, 5, 18, 30, tzinfo=UTC)) == "12:00 AM IST, Tue 6 Oct"
    assert ist_stamp(datetime(2026, 10, 6, 6, 30, tzinfo=UTC)) == "12:00 PM IST, Tue 6 Oct"


def test_warns_never_to_share_the_code():
    email = make()
    assert "never ask for this code" in email.body
    assert "never ask for this code" in (email.html or "")


def test_footer_names_the_recipient_escaped():
    html = make(to='odd"<b>@geu.ac.in').html or ""
    assert "Sent to odd&quot;&lt;b&gt;@geu.ac.in" in html
    assert "<b>@" not in html


def test_greets_by_first_name():
    email = make("Riya Sharma")
    assert email.body.startswith("Hi Riya,")
    assert "Hi Riya," in (email.html or "")


def test_student_supplied_name_is_html_escaped():
    email = make('<img src=x onerror=alert(1)> "Mallory"')
    html = email.html or ""
    assert "<img" not in html
    assert "&lt;img" in html


def test_blank_name_falls_back_gracefully():
    assert make("   ").body.startswith("Hi there,")


def test_no_links_or_remote_images():
    """Spam filters distrust links in verification mail; Outlook blocks remote images."""
    html = make().html or ""
    assert "http://" not in html and "https://" not in html
    assert "<img" not in html and "<a " not in html


def test_message_is_multipart_with_text_first():
    message = build_message(make(), "Lumiback <no-reply@outing.example.com>")
    assert message.get_content_type() == "multipart/alternative"
    parts = [part.get_content_type() for part in message.iter_parts()]
    assert parts == ["text/plain", "text/html"]  # clients show the last part they support
    assert message["Subject"] == "048291 is your Lumiback code"
    assert message["From"] == "Lumiback <no-reply@outing.example.com>"


def test_text_only_email_stays_single_part():
    message = build_message(Email(to="a@geu.ac.in", subject="s", body="hello"), "x@y.z")
    assert message.get_content_type() == "text/plain"
