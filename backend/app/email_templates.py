"""Transactional email templates: a plain-text body always, and an optional HTML version.

History: a controlled test against Graphic Era's Microsoft 365 (2026-10-06) sent the same code
email four ways; both HTML variants (hidden preheader, dark-mode <style> block, dashed code box,
marketing lines) landed in Junk, while plain text reached the Inbox. This design was tested the
same way on 2026-10-08 (plain text, HTML with a plain code, HTML with a boxed code; same sender
and subject shape) and all three reached the Inbox, so HTML_EMAILS is on. Rerun that test
(.claude/scripts/html_inbox_test.py) before changing the layout, sender or subject.

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

# On since the 2026-10-08 Microsoft 365 inbox test (see module docstring).
HTML_EMAILS = True

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
        f"{_footer_text()}"
    )


P = f"margin:0;font-family:{SANS};font-size:15px;line-height:22px;color:{INK};"
SMALL = f"margin:0;font-family:{SANS};font-size:13px;line-height:19px;color:{MUTED};"

# Where replies go (Settings.email_reply_to; the mailers set the Reply-To header). When it's
# unset, no email invites a reply. Set once at startup by set_reply_to().
REPLY_TO: str | None = None
HELP_LINE = "Questions? Reply to this email."


def set_reply_to(address: str | None) -> None:
    global REPLY_TO
    REPLY_TO = address


def _footer_text() -> str:
    return f"\n{HELP_LINE}\n" if REPLY_TO else ""


def _shell(*, title: str, card: str, to: str, reason: str) -> str:
    """The inbox-tested layout every email shares: wordmark, one white card, a small footer."""
    help_line = f"<br>{HELP_LINE}" if REPLY_TO else ""
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{escape(title)}</title>
</head>
<body style="margin:0;padding:0;background:{PAGE};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{PAGE};">
<tr><td align="center" style="padding:28px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
<tr><td style="padding:0 4px 14px;font-family:{SANS};font-size:20px;font-weight:bold;color:{INK};">Lumiback</td></tr>
<tr><td style="background:#ffffff;border:1px solid {LINE};border-radius:12px;padding:28px 26px;">
{card}
</td></tr>
<tr><td style="padding:16px 4px 0;font-family:{SANS};font-size:12px;line-height:18px;color:{MUTED};">Sent to {escape(to)} because {escape(reason)}.<br>Lumiback, for Graphic Era hostel students.{help_line}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""


def _html(m: CodeEmail, *, boxed_code: bool = True) -> str:
    code_style = (
        f"background:{CODE_BG};border:1px solid #d9def5;border-radius:10px;padding:14px 8px;"
        if boxed_code
        else "padding:4px 0;"
    )
    card = f"""<p style="{P}">Hi {escape(m.first_name)},</p>
<h1 style="margin:12px 0 8px;font-family:{SANS};font-size:22px;line-height:28px;font-weight:bold;color:{INK};">{escape(m.heading)}</h1>
<p style="{P}">{escape(m.purpose)}:</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 10px;"><tr>
<td align="center" style="{code_style}font-family:{MONO};font-size:32px;line-height:38px;letter-spacing:6px;font-weight:bold;color:{ACCENT};">{escape(m.code)}</td>
</tr></table>
<p style="{SMALL}">It expires in {m.minutes} minutes. Requested at {escape(m.when)}.</p>
<p style="{P}margin-top:20px;">Lumiback will never ask for this code by phone, chat or email. Don't share it.</p>
<p style="{SMALL}margin-top:14px;">{escape(m.ignore_line)}</p>"""
    return _shell(title=m.heading, card=card, to=m.to, reason=m.reason)


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


# ---------- notices: late alerts, request decisions, admin escalations ----------
#
# Students with the app get a push instead; these go to students who only use the website
# (and to admins). Plain text reached the GEU inbox on 2026-10-09; the HTML version (same words,
# the shared layout, one action link) stays off until its own inbox test passes.

NOTICE_HTML = False

GOOD = "#187349"
DANGER = "#b8322a"
TONE = {"alert": DANGER, "good": GOOD, "neutral": MUTED}

# Why a student gets these by email at all; part of the footer's "Sent to ... because ...".


@dataclass(frozen=True)
class Notice:
    """The words of a notice; rendered once as text and once as HTML."""

    to: str
    subject: str
    greeting: str  # "Hi Riya,"
    label: str  # a short status above the heading: "Late check-in", "Approved"
    tone: str  # "alert" | "good" | "neutral"
    heading: str
    paragraphs: tuple[str, ...]
    action: tuple[str, str]  # (button label, URL)
    note: str | None  # small print under the action
    reason: str  # why this address got the email (footer)
    # How the HTML shows the action: "button", "text" (a written-out link) or "plain" (the
    # address with no link at all). Urgent notices use "plain": a red alert plus a button reads
    # as phishing to Microsoft 365 (the late alert went to Junk with a button, 2026-10-09).
    link: str = "button"


def _hhmm(moment: datetime) -> str:
    t = moment.astimezone(IST)
    return f"{t.hour % 12 or 12}:{t.minute:02d} {'AM' if t.hour < 12 else 'PM'}"


def _notice_text(n: Notice) -> str:
    label, url = n.action
    # Same words as the HTML part, which filters compare: the status label leads the heading.
    parts = [n.greeting, f"{n.label}\n{n.heading}", *n.paragraphs, f"{label}: {url}"]
    if n.note:
        parts.append(n.note)
    parts.append(f"Sent to {n.to} because {n.reason}.")
    return "\n\n".join(parts) + "\n" + _footer_text()


def _notice_html(n: Notice, *, link: str | None = None) -> str:
    """`link` overrides the notice's own style (for inbox tests)."""
    label, url = n.action
    link = link or n.link
    if link == "plain":
        shown = url.removeprefix("https://")
        action = (
            f'<p style="{P}margin-top:20px;">{escape(label)}: <strong>{escape(shown)}</strong></p>'
        )
    elif link == "button":
        action = f"""<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;"><tr>
<td style="background:{ACCENT};border-radius:10px;"><a href="{escape(url)}" style="display:inline-block;padding:13px 22px;font-family:{SANS};font-size:15px;line-height:20px;font-weight:bold;color:#ffffff;text-decoration:none;">{escape(label)}</a></td>
</tr></table>"""
    else:
        shown = url.removeprefix("https://")
        action = (
            f'<p style="{P}margin-top:20px;">{escape(label)}: '
            f'<a href="{escape(url)}" style="color:{ACCENT};font-weight:bold;">{escape(shown)}</a></p>'
        )
    paragraphs = "\n".join(f'<p style="{P}margin-top:10px;">{escape(p)}</p>' for p in n.paragraphs)
    note = f'<p style="{SMALL}margin-top:18px;">{escape(n.note)}</p>' if n.note else ""
    card = f"""<p style="{P}">{escape(n.greeting)}</p>
<p style="margin:18px 0 0;font-family:{SANS};font-size:12px;line-height:16px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:{TONE[n.tone]};">{escape(n.label)}</p>
<h1 style="margin:6px 0 4px;font-family:{SANS};font-size:22px;line-height:28px;font-weight:bold;color:{INK};">{escape(n.heading)}</h1>
{paragraphs}
{action}
{note}"""
    return _shell(title=n.heading, card=card, to=n.to, reason=n.reason)


def notice_email(n: Notice, *, html: bool | None = None, link: str | None = None) -> Email:
    """Plain text always; the HTML alternative when enabled (or forced, for inbox tests)."""
    with_html = NOTICE_HTML if html is None else html
    return Email(
        to=n.to,
        subject=n.subject,
        body=_notice_text(n),
        html=_notice_html(n, link=link) if with_html else None,
    )


def late_alert_notice(*, to: str, name: str, due_at: datetime, web_url: str) -> Notice:
    return Notice(
        to=to,
        subject="Lumiback: are you OK? You're 30 minutes past your return time",
        greeting=f"Hi {_first(name)},",
        label="Late check-in",
        tone="alert",
        heading="Are you OK?",
        paragraphs=(
            f"You were due back at {_hhmm(due_at)} and haven't checked in yet.",
            'Let the hostel office know: choose "On my way" or "I\'m safe". Checking in at '
            "the gate works too.",
        ),
        action=("Answer in the Lumiback app or at", f"{web_url}/home"),
        note=(
            "If there's no answer within 10 minutes, the hostel office is told and may call "
            "you or your emergency contact."
        ),
        reason="you're out on a Lumiback outing",
        link="plain",
    )


def late_alert_email(*, to: str, name: str, due_at: datetime, web_url: str) -> Email:
    """30 minutes past the return time, for a student with no app to push to."""
    return notice_email(late_alert_notice(to=to, name=name, due_at=due_at, web_url=web_url))


def request_decision_notice(
    *, to: str, name: str, approved: bool, note: str | None, web_url: str
) -> Notice:
    if approved:
        return Notice(
            to=to,
            subject="Lumiback: your outing request is approved",
            greeting=f"Hi {_first(name)},",
            label="Approved",
            tone="good",
            heading="Today's outing is approved",
            paragraphs=(
                "The hostel office approved your outing request for today.",
                "Tap out at the gate when you leave, or check out on the website. Your hostel's "
                "return time still applies.",
            ),
            action=("Open Lumiback", f"{web_url}/home"),
            note=None,
            reason="you asked the hostel office for an outing",
        )
    return Notice(
        to=to,
        subject="Lumiback: your outing request was declined",
        greeting=f"Hi {_first(name)},",
        label="Declined",
        tone="neutral",
        heading="Today's outing request was declined",
        paragraphs=(
            *((f"The hostel office's note: {note}",) if note else ()),
            "You can send a new request, or ask the hostel office if you have questions.",
        ),
        action=("Send a new request", f"{web_url}/home"),
        note=None,
        reason="you asked the hostel office for an outing",
    )


def request_decision_email(
    *, to: str, name: str, approved: bool, note: str | None, web_url: str
) -> Email:
    """The hostel office's answer to a weekend or holiday outing request."""
    return notice_email(
        request_decision_notice(to=to, name=name, approved=approved, note=note, web_url=web_url)
    )


def escalation_notice(*, to: str, count: int, web_url: str) -> Notice:
    """To admins. Names and numbers stay behind the sign-in: the email only points there."""
    students = "1 late student isn't" if count == 1 else f"{count} late students aren't"
    return Notice(
        to=to,
        subject=f"Lumiback: {count} late student(s) not answering",
        greeting="Hello,",
        label="Needs follow-up",
        tone="alert",
        heading=f"{students} answering",
        paragraphs=(
            "They're over 40 minutes late and didn't answer the app's alert.",
            "Their phone numbers, emergency contacts, hostel warden and last known position are "
            "on the Escalations page.",
        ),
        action=("Open Escalations", f"{web_url}/admin/escalations"),
        note=None,
        reason="you're a Lumiback admin",
    )


def escalation_email(*, to: str, count: int, web_url: str) -> Email:
    return notice_email(escalation_notice(to=to, count=count, web_url=web_url))
