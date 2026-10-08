"""Transactional email templates.

Verification codes go out as plain text on purpose. A controlled test against Graphic Era's
Microsoft 365 (2026-10-06) sent the same code email four ways: both HTML variants landed in
Junk, while the plain-text one and a plain no-code message reached the Inbox. A code that
lands in Junk is a broken sign-up, so deliverability wins over styling here.
"""

from datetime import UTC, datetime

from app.email import Email
from app.schemas import IST


def ist_stamp(moment: datetime) -> str:
    """'10:41 PM IST, Tue 6 Oct' (portable: no platform-specific strftime flags)."""
    t = moment.astimezone(IST)
    hour = t.hour % 12 or 12
    period = "AM" if t.hour < 12 else "PM"
    return f"{hour}:{t.minute:02d} {period} IST, {t.strftime('%a')} {t.day} {t.strftime('%b')}"


def verification_email(
    *, to: str, name: str, code: str, minutes: int, requested_at: datetime | None = None
) -> Email:
    first = name.split()[0] if name.split() else "there"
    when = ist_stamp(requested_at or datetime.now(UTC))
    text = (
        f"Hi {first},\n\n"
        f"Your Lumiback verification code is {code}.\n"
        f"It expires in {minutes} minutes. Requested at {when}.\n\n"
        "Lumiback will never ask for this code by phone, chat or email. Don't share it.\n\n"
        "If you did not create a Lumiback account, you can ignore this email. "
        "Nobody can use the account without this code.\n"
    )
    return Email(to=to, subject=f"{code} is your Lumiback code", body=text)


def password_reset_email(
    *, to: str, name: str, code: str, minutes: int, requested_at: datetime | None = None
) -> Email:
    """Same plain-text shape (and subject) as the sign-up code, which reaches the inbox."""
    first = name.split()[0] if name.split() else "there"
    when = ist_stamp(requested_at or datetime.now(UTC))
    text = (
        f"Hi {first},\n\n"
        f"Your Lumiback password reset code is {code}.\n"
        f"It expires in {minutes} minutes. Requested at {when}.\n\n"
        "Lumiback will never ask for this code by phone, chat or email. Don't share it.\n\n"
        "If you did not ask to reset your password, you can ignore this email. "
        "Your password stays the same unless this code is used.\n"
    )
    return Email(to=to, subject=f"{code} is your Lumiback code", body=text)
