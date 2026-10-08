"""Transactional email templates: a plain-text body always, and an optional HTML version.

History: a controlled test against Graphic Era's Microsoft 365 (2026-10-06) sent the same code
email four ways; both HTML variants (hidden preheader, dark-mode <style> block, dashed code box,
marketing lines) landed in Junk, while plain text reached the Inbox. So codes went out as plain
text, and HTML stays off (HTML_EMAILS) until a new single-variable inbox test passes.

The HTML here is built for filters as much as for people: one table column, inline styles only,
system fonts, no images, no links, no hidden text, no <style> block, and the same words as the
plain-text part (multipart/alternative). Every user-supplied value is HTML-escaped.
"""

# Inline-styled email HTML (email clients ignore <style>) makes long lines; readable as they are.
# ruff: noqa: E501

from dataclasses import dataclass
from datetime import UTC, datetime
from html import escape

from app.email import Email
from app.schemas import IST

# Off until the HTML version is shown to reach a Microsoft 365 inbox (see module docstring).
HTML_EMAILS = False

INK = "#0b0c10"
MUTED = "#5b606b"
LINE = "#e7e8ec"
PAGE = "#f4f5f7"
ACCENT = "#1f3fd1"
CODE_BG = "#f1f3fc"
SANS = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
MONO = "Consolas, 'SF Mono', Menlo, monospace"


def ist_stamp(moment: datetime) -> str:
    """'10:41 PM IST, Tue 6 Oct' (portable: no platform-specific strftime flags)."""
    t = moment.astimezone(IST)
    hour = t.hour % 12 or 12
    period = "AM" if t.hour < 12 else "PM"
    return f"{hour}:{t.minute:02d} {period} IST, {t.strftime('%a')} {t.day} {t.strftime('%b')}"


@dataclass(frozen=True)
class CodeEmail:
    """The words of a code email; rendered once as text and once as HTML."""

    to: str
    first_name: str
    heading: str
    purpose: str  # "Your Lumiback verification code is"
    code: str
    minutes: int
    when: str
    ignore_line: str  # what to do if it wasn't you
    reason: str  # why this address got the email (footer)


def _text(m: CodeEmail) -> str:
    return (
        f"Hi {m.first_name},\n\n"
        f"{m.purpose} {m.code}.\n"
        f"It expires in {m.minutes} minutes. Requested at {m.when}.\n\n"
        "Lumiback will never ask for this code by phone, chat or email. Don't share it.\n\n"
        f"{m.ignore_line}\n"
    )


def _html(m: CodeEmail, *, boxed_code: bool = True) -> str:
    code_style = (
        f"background:{CODE_BG};border:1px solid #d9def5;border-radius:10px;padding:14px 8px;"
        if boxed_code
        else "padding:4px 0;"
    )
    p = f"margin:0;font-family:{SANS};font-size:15px;line-height:22px;color:{INK};"
    small = f"margin:0;font-family:{SANS};font-size:13px;line-height:19px;color:{MUTED};"
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{escape(m.heading)}</title>
</head>
<body style="margin:0;padding:0;background:{PAGE};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{PAGE};">
<tr><td align="center" style="padding:28px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
<tr><td style="padding:0 4px 14px;font-family:{SANS};font-size:20px;font-weight:bold;color:{INK};">Lumiback</td></tr>
<tr><td style="background:#ffffff;border:1px solid {LINE};border-radius:12px;padding:28px 26px;">
<p style="{p}">Hi {escape(m.first_name)},</p>
<h1 style="margin:12px 0 8px;font-family:{SANS};font-size:22px;line-height:28px;font-weight:bold;color:{INK};">{escape(m.heading)}</h1>
<p style="{p}">{escape(m.purpose)}:</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 10px;"><tr>
<td align="center" style="{code_style}font-family:{MONO};font-size:32px;line-height:38px;letter-spacing:6px;font-weight:bold;color:{ACCENT};">{escape(m.code)}</td>
</tr></table>
<p style="{small}">It expires in {m.minutes} minutes. Requested at {escape(m.when)}.</p>
<p style="{p}margin-top:20px;">Lumiback will never ask for this code by phone, chat or email. Don't share it.</p>
<p style="{small}margin-top:14px;">{escape(m.ignore_line)}</p>
</td></tr>
<tr><td style="padding:16px 4px 0;font-family:{SANS};font-size:12px;line-height:18px;color:{MUTED};">Sent to {escape(m.to)} because {escape(m.reason)}.<br>Lumiback, for Graphic Era hostel students.</td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""


def code_email(m: CodeEmail, *, html: bool | None = None, boxed_code: bool = True) -> Email:
    """Plain text always; the HTML alternative when enabled (or forced, for inbox tests)."""
    with_html = HTML_EMAILS if html is None else html
    return Email(
        to=m.to,
        subject=f"{m.code} is your Lumiback code",
        body=_text(m),
        html=_html(m, boxed_code=boxed_code) if with_html else None,
    )


def _first(name: str) -> str:
    return name.split()[0] if name.split() else "there"


def verification_message(
    *, to: str, name: str, code: str, minutes: int, requested_at: datetime | None = None
) -> CodeEmail:
    return CodeEmail(
        to=to,
        first_name=_first(name),
        heading="Confirm your university email",
        purpose="Your Lumiback verification code is",
        code=code,
        minutes=minutes,
        when=ist_stamp(requested_at or datetime.now(UTC)),
        ignore_line=(
            "If you did not create a Lumiback account, you can ignore this email. "
            "Nobody can use the account without this code."
        ),
        reason="someone started creating a Lumiback account with it",
    )


def verification_email(
    *, to: str, name: str, code: str, minutes: int, requested_at: datetime | None = None
) -> Email:
    return code_email(
        verification_message(
            to=to, name=name, code=code, minutes=minutes, requested_at=requested_at
        )
    )


def password_reset_email(
    *, to: str, name: str, code: str, minutes: int, requested_at: datetime | None = None
) -> Email:
    return code_email(
        CodeEmail(
            to=to,
            first_name=_first(name),
            heading="Reset your password",
            purpose="Your Lumiback password reset code is",
            code=code,
            minutes=minutes,
            when=ist_stamp(requested_at or datetime.now(UTC)),
            ignore_line=(
                "If you did not ask to reset your password, you can ignore this email. "
                "Your password stays the same unless this code is used."
            ),
            reason="someone asked to reset the Lumiback password for it",
        )
    )
