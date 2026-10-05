"""Verification email: content, escaping, and the MIME structure actually sent."""

from app.email import Email, build_message
from app.email_templates import verification_email


def make(name: str = "Riya Sharma") -> Email:
    return verification_email(to="riya@geu.ac.in", name=name, code="048291", minutes=15)


def test_code_is_in_subject_text_and_html():
    email = make()
    assert email.subject == "048291 is your Lumiback code"  # readable from the notification
    assert "Your Lumiback verification code is 048291." in email.body
    assert email.html is not None and ">048291</td>" in email.html
    assert "expires in 15 minutes" in email.body and "expires in 15 minutes" in email.html


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
