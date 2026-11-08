"""Transactional email templates: a plain-text body always, and an optional HTML version.

History: a controlled test against Graphic Era's Microsoft 365 (2026-10-06) sent the same code
email four ways; both HTML variants (hidden preheader, dark-mode <style> block, dashed code box,
marketing lines) landed in Junk, while plain text reached the Inbox. This design was tested the
same way on 2026-10-08 (plain text, HTML with a plain code, HTML with a boxed code; same sender
and subject shape) and all three reached the Inbox, so HTML_EMAILS is on. Rerun that test
(.claude/scripts/html_inbox_test.py) before changing the layout, sender or subject.

The HTML here is built for filters as much as for people: one table column, inline styles only,
system fonts, one small image (the app icon, see LOGO_URL), no hidden text, no <style> block,
and the same words as the plain-text part (multipart/alternative). Every user-supplied value is
HTML-escaped.
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


# The app icon beside the wordmark, served by the website (a PNG: Outlook doesn't show SVG).
# Decorative (empty alt): with images blocked, the "Lumiback" wordmark still reads the same.
# Set once at startup by set_logo(); unset, emails show the wordmark alone.
LOGO_URL: str | None = None


def set_logo(web_url: str | None) -> None:
    global LOGO_URL
    LOGO_URL = f"{web_url}/icons/icon-192.png" if web_url else None


def _brand() -> str:
    if not LOGO_URL:
        return "Lumiback"
    return (
        f'<img src="{escape(LOGO_URL)}" width="28" height="28" alt="" '
        'style="display:inline-block;width:28px;height:28px;border:0;border-radius:7px;'
        'vertical-align:middle;margin-right:8px;">'
        '<span style="vertical-align:middle;">Lumiback</span>'
    )


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
<tr><td style="padding:0 4px 14px;font-family:{SANS};font-size:20px;line-height:28px;font-weight:bold;color:{INK};">{_brand()}</td></tr>
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
<td align="center" style="{code_style}-webkit-user-select:all;user-select:all;font-family:{MONO};font-size:32px;line-height:38px;letter-spacing:6px;font-weight:bold;color:{ACCENT};">{escape(m.code)}</td>
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
# (and to admins). Each kind sends HTML only after it reached the GEU Microsoft 365 inbox on
# its own (tests on 2026-10-09, one email at a time):
# - "approved" (brand-first subject, two paragraphs, button) and "escalation": Inbox.
#   The first "approved" shape (bare subject, one sentence, long footer) went to Junk.
# - "late": every HTML version went to Junk, with a button, a text link or no link; urgency in
#   HTML reads as phishing. Plain text reached the Inbox, and a missed alert is worse than a
#   plain one, so it stays plain text.
# - "declined" (same shape as "approved"): Inbox.
# - "safe_return_start" (to the emergency contact, button for the follow link): Inbox at GEU
#   Microsoft 365 and Gmail, like both plain-text controls sent before and after it
#   (2026-11-06, .claude/scripts/safe_return_inbox_test.py).
# - "safe_return_overdue" (to the emergency contact, a details table with a tappable phone
#   number and follow link, no button): Inbox at GEU Microsoft 365 and Gmail, like both
#   plain-text controls (2026-11-06, .claude/scripts/safe_return_overdue_formatted_inbox_test.py).
#   Unlike "late", it goes to someone who asked to follow the outing.
# - "account_invite", "account_reset" and "safe_return_back": switched to HTML on 2026-11-07 at
#   the owner's request ("the password link email isn't formatted"), in the shape that passed
#   above (brand-first subject, short paragraphs, one button or none). Not inbox-tested on their
#   own yet: run .claude/scripts/html_inbox_test.py for them before a large import.

HTML_NOTICES = frozenset(
    {
        "approved",
        "declined",
        "escalation",
        "safe_return_start",
        "safe_return_overdue",
        "account_invite",
        "account_reset",
        "safe_return_back",
    }
)

GOOD = "#187349"
DANGER = "#b8322a"
TONE = {"alert": DANGER, "good": GOOD, "neutral": MUTED}

# Why a student gets these by email at all; part of the footer's "Sent to ... because ...".


@dataclass(frozen=True)
class Detail:
    """One row of a notice's details table: "<name>  <strong>value_strong</strong>value"."""

    name: str
    value: str
    value_strong: str = ""
    href: str | None = None  # makes the value a link (https: or tel:)
    note: str | None = None  # small print under the value


@dataclass(frozen=True)
class Notice:
    """The words of a notice; rendered once as text and once as HTML."""

    kind: str  # "late" | "approved" | "declined" | "escalation" (see HTML_NOTICES)
    to: str
    subject: str
    greeting: str  # "Hi Riya,"
    label: str  # a short status above the heading: "Late check-in", "Approved"
    tone: str  # "alert" | "good" | "neutral"
    heading: str
    paragraphs: tuple[str, ...]
    action: tuple[str, str] | None  # (button label, URL); None: nothing to do
    note: str | None  # small print under the action
    reason: str  # why this address got the email (footer)
    # How the HTML shows the action: "button", "text" (a written-out link) or "plain" (the
    # address with no link at all). Urgent notices use "plain": a red alert plus a button reads
    # as phishing to Microsoft 365 (the late alert went to Junk with a button, 2026-10-09).
    link: str = "button"
    # With details, the HTML shows these rows in place of the action and note, and its own
    # lead paragraphs (the facts in the rows aren't repeated). The text part is unchanged.
    details: tuple[Detail, ...] = ()
    html_paragraphs: tuple[str, ...] | None = None


def _hhmm(moment: datetime) -> str:
    t = moment.astimezone(IST)
    return f"{t.hour % 12 or 12}:{t.minute:02d} {'AM' if t.hour < 12 else 'PM'}"


def _day(moment: datetime) -> str:
    """'Sat 7 Nov' in IST (portable: no platform-specific strftime flags)."""
    t = moment.astimezone(IST)
    return f"{t.strftime('%a')} {t.day} {t.strftime('%b')}"


def _notice_text(n: Notice) -> str:
    # Same words as the HTML part, which filters compare: the status label leads the heading.
    parts = [n.greeting, f"{n.label}\n{n.heading}", *n.paragraphs]
    if n.action:
        label, url = n.action
        parts.append(f"{label}: {url}")
    if n.note:
        parts.append(n.note)
    parts.append(f"Sent to {n.to} because {n.reason}.")
    return "\n\n".join(parts) + "\n" + _footer_text()


def _notice_html(n: Notice, *, link: str | None = None) -> str:
    """`link` overrides the notice's own style (for inbox tests)."""
    label, url = n.action or ("", "")
    link = link or n.link
    if n.action is None:
        action = ""
    elif link == "plain":
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
    note = f'<p style="{SMALL}margin-top:18px;">{escape(n.note)}</p>' if n.note else ""
    if n.details:
        action, note = _details_html(n), ""
    shown_paragraphs = n.html_paragraphs if n.html_paragraphs is not None else n.paragraphs
    paragraphs = "\n".join(
        f'<p style="{P}margin-top:10px;">{escape(p)}</p>' for p in shown_paragraphs
    )
    card = f"""<p style="{P}">{escape(n.greeting)}</p>
<p style="margin:18px 0 0;font-family:{SANS};font-size:12px;line-height:16px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:{TONE[n.tone]};">{escape(n.label)}</p>
<h1 style="margin:6px 0 4px;font-family:{SANS};font-size:22px;line-height:28px;font-weight:bold;color:{INK};">{escape(n.heading)}</h1>
{paragraphs}
{action}
{note}"""
    return _shell(title=n.heading, card=card, to=n.to, reason=n.reason)


def _details_html(n: Notice) -> str:
    link_style = f"color:{ACCENT};font-weight:bold;word-break:break-all;"
    cell = "padding:12px 14px;vertical-align:top;font-family:" + SANS + ";"
    rows = []
    for i, d in enumerate(n.details):
        border = "" if i == len(n.details) - 1 else f"border-bottom:1px solid {LINE};"
        value = (f"<strong>{escape(d.value_strong)}</strong>" if d.value_strong else "") + escape(
            d.value
        )
        if d.href:
            value = f'<a href="{escape(d.href)}" style="{link_style}">{value}</a>'
        if d.note:
            value += (
                f'<br><span style="font-size:13px;line-height:19px;color:{MUTED};">'
                f"{escape(d.note)}</span>"
            )
        rows.append(
            f'<tr><td style="{cell}{border}font-size:13px;line-height:19px;color:{MUTED};'
            f'width:96px;">{escape(d.name)}</td>'
            f'<td style="{cell}{border}font-size:15px;line-height:22px;color:{INK};">'
            f"{value}</td></tr>"
        )
    accent = TONE[n.tone]
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" '
        f'style="margin-top:18px;border:1px solid {LINE};border-left:3px solid {accent};'
        f'border-radius:8px;border-collapse:separate;">\n' + "\n".join(rows) + "\n</table>"
    )


def notice_email(n: Notice, *, html: bool | None = None, link: str | None = None) -> Email:
    """Plain text always; the HTML alternative when enabled (or forced, for inbox tests)."""
    with_html = n.kind in HTML_NOTICES if html is None else html
    return Email(
        to=n.to,
        subject=n.subject,
        body=_notice_text(n),
        html=_notice_html(n, link=link) if with_html else None,
    )


def late_alert_notice(*, to: str, name: str, due_at: datetime, web_url: str) -> Notice:
    return Notice(
        kind="late",
        to=to,
        # A time, not "30 minutes ago": that's wrong by the time the email is read.
        subject=f"Lumiback: are you OK? You were due back at {_hhmm(due_at)} IST",
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
            kind="approved",
            to=to,
            subject="Lumiback: your outing request is approved",
            greeting=f"Hi {_first(name)},",
            label="Approved",
            tone="good",
            heading="Today's outing is approved",
            paragraphs=(
                "The hostel office approved your outing request for today.",
                "Tap out at the gate when you leave, or log your trip in Lumiback. Your hostel's "
                "return time still applies.",
            ),
            action=("Open Lumiback", f"{web_url}/home"),
            note=None,
            reason="you asked the hostel office for an outing",
        )
    return Notice(
        kind="declined",
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
    """To the hostel office (admins, head wardens, the hostel's wardens). Names and numbers stay
    behind the sign-in: the email only points there."""
    students = "1 late student needs" if count == 1 else f"{count} late students need"
    return Notice(
        kind="escalation",
        to=to,
        subject=f"Lumiback: {count} late student(s) need follow-up",
        greeting="Hello,",
        label="Needs follow-up",
        tone="alert",
        heading=f"{students} follow-up",
        paragraphs=(
            "They're over 40 minutes late and didn't answer the app's alert, or answered but "
            "still aren't back an hour later.",
            "Their phone numbers, emergency contacts, hostel warden and last known position are "
            "on the Escalations page.",
        ),
        action=("Open Escalations", f"{web_url}/admin/escalations"),
        note=None,
        # Admins, head wardens and the student's hostel wardens all get it: say what's true of all.
        reason="you're on the Lumiback hostel office for this student",
    )


def escalation_email(*, to: str, count: int, web_url: str) -> Email:
    return notice_email(escalation_notice(to=to, count=count, web_url=web_url))


# ---------- set-password links an admin sends (imported students, admin resets) ----------
#
# HTML with a button, plus the same words as plain text (see HTML_NOTICES). No password is
# ever in these emails: the student picks one through the link.


def account_link_email(*, to: str, name: str, invite: bool, link: str) -> Email:
    if invite:
        notice = Notice(
            kind="account_invite",
            to=to,
            subject="Lumiback: set up your account",
            greeting=f"Hi {_first(name)},",
            label="Your account",
            tone="neutral",
            heading="Your hostel office added you to Lumiback",
            paragraphs=(
                "Lumiback is Graphic Era's hostel outing app: students tap out and back in at "
                "the gate and ask for weekend outings, and the hostel office approves requests "
                "and follows up on late returns.",
                "Choose your password to start. The link works once and expires in 7 days. "
                "After that, use Forgot password on the sign-in page.",
            ),
            action=("Choose your password", link),
            note="If you weren't expecting this, you can ignore this email.",
            reason="the hostel office added this address to Lumiback",
        )
    else:
        notice = Notice(
            kind="account_reset",
            to=to,
            subject="Lumiback: choose a new password",
            greeting=f"Hi {_first(name)},",
            label="Password reset",
            tone="neutral",
            heading="The hostel office reset your password",
            paragraphs=(
                "Your old password no longer works, and Lumiback has signed you out on every "
                "device. Choose a new password to sign in again.",
                "The link works once and expires in 24 hours.",
            ),
            action=("Choose a new password", link),
            note="If you didn't ask the hostel office for this, tell them.",
            reason="the hostel office reset the password of this Lumiback account",
        )
    return notice_email(notice)


# ---------- safe return: to a student's emergency contact ----------
#
# The contact has no account and never asked for these, so each one says who chose to send it
# and why. The start email is HTML with a button, and the overdue email HTML with a details
# table and no button (both inbox-tested, see HTML_NOTICES). The back email is HTML with no
# button (see HTML_NOTICES).


def _contact_reason(student: str) -> str:
    return (
        f"{student} gave this address as their emergency contact in Lumiback and chose to let "
        "you follow this outing"
    )


def safe_return_start_email(
    *, to: str, contact_name: str | None, student: str, due_at: datetime, link: str
) -> Email:
    first = _first(student)
    return notice_email(
        Notice(
            kind="safe_return_start",
            to=to,
            subject=f"Lumiback: {student} is out and chose you to follow their way back",
            greeting=f"Hi {_first(contact_name or '')},",
            label="Safe return",
            tone="neutral",
            heading=f"{first} has left the hostel",
            paragraphs=(
                f"{student} checked out of their hostel at Graphic Era and is due back by "
                f"{_hhmm(due_at)} IST. They chose to let you see their location until they're "
                "back.",
                "The link shows where they are while they share it from Lumiback. It stops "
                "working when they're back, or if they stop sharing. You don't need an account.",
                "If they're 30 minutes late, we'll email you. We'll also tell you when they're "
                "back.",
            ),
            action=("Follow their way back", link),
            note="Keep this link to yourself: anyone who has it can see their location until "
            "they're back.",
            reason=_contact_reason(student),
        )
    )


def safe_return_overdue_email(
    *,
    to: str,
    contact_name: str | None,
    student: str,
    due_at: datetime,
    phone: str | None,
    link: str,
) -> Email:
    return notice_email(
        safe_return_overdue_notice(
            to=to,
            contact_name=contact_name,
            student=student,
            due_at=due_at,
            phone=phone,
            link=link,
        )
    )


def safe_return_overdue_notice(
    *,
    to: str,
    contact_name: str | None,
    student: str,
    due_at: datetime,
    phone: str | None,
    link: str,
) -> Notice:
    first = _first(student)
    details = (
        Detail("Due back", f", {_day(due_at)}", value_strong=f"{_hhmm(due_at)} IST"),
        *((Detail("Phone", phone, href=f"tel:{phone.replace(' ', '')}"),) if phone else ()),
        Detail(
            "Location",
            link.removeprefix("https://"),
            href=link,
            note="Shows a position only while they share it from Lumiback.",
        ),
    )
    return Notice(
        kind="safe_return_overdue",
        to=to,
        subject=f"Lumiback: {student} was due back at {_hhmm(due_at)} IST",
        greeting=f"Hi {_first(contact_name or '')},",
        label="Late",
        tone="alert",
        heading=f"{first} isn't back yet",
        paragraphs=(
            f"{student} was due back at the hostel by {_hhmm(due_at)} IST and hasn't checked "
            "in yet. Lumiback has asked them if they're OK. If they don't answer, the hostel "
            "office follows up.",
            *((f"You can call them on {phone}.",) if phone else ()),
        ),
        action=("See where they are", link),
        note="The map shows a position only while they share it from Lumiback.",
        reason=_contact_reason(student),
        details=details,
        html_paragraphs=(
            f"{student} hasn't checked in at the hostel yet. Lumiback has asked them if they're "
            "OK. If they don't answer, the hostel office follows up.",
        ),
    )


def safe_return_back_email(
    *, to: str, contact_name: str | None, student: str, returned_at: datetime
) -> Email:
    return notice_email(
        Notice(
            kind="safe_return_back",
            to=to,
            subject=f"Lumiback: {student} is back",
            greeting=f"Hi {_first(contact_name or '')},",
            label="Back",
            tone="good",
            heading=f"{_first(student)} is back at the hostel",
            paragraphs=(
                f"{student} checked back in at {_hhmm(returned_at)} IST. The link to follow "
                "them has stopped working, and their location is no longer shared with you.",
            ),
            action=None,
            note=None,
            reason=_contact_reason(student),
        )
    )


# ---------- wave 2 alerts (plain text: these layouts haven't had an inbox test) ----------
#
# To the hostel office, names and numbers stay behind the sign-in, as in the escalation email.

OFFICE_REASON = "you're on the Lumiback hostel office for this student"


def escalation_follow_up_email(*, to: str, handed_over: bool, web_url: str) -> Email:
    """Nobody has claimed an open escalation: a re-alert, or the hand-over to head wardens."""
    if handed_over:
        heading = "A late student's follow-up is now with you"
        first = (
            "Nobody in the student's hostel office has claimed it yet, so it has been handed "
            "to the head wardens."
        )
    else:
        heading = "A late student still has nobody following up"
        first = "Nobody has claimed it on the Escalations page yet."
    return notice_email(
        Notice(
            kind="escalation_follow_up",
            to=to,
            subject=f"Lumiback: {heading.lower()}",
            greeting="Hello,",
            label="Needs follow-up",
            tone="alert",
            heading=heading,
            paragraphs=(
                first,
                'Open Escalations and choose "I\'m on it" so the office knows someone is '
                "calling. Their phone numbers and emergency contact are there.",
            ),
            action=("Open Escalations", f"{web_url}/admin/escalations"),
            note=None,
            reason=OFFICE_REASON,
            link="plain",
        )
    )


def request_waiting_email(*, to: str, backup: bool, minutes: int, web_url: str) -> Email:
    """A pending outing request: a reminder to the hostel's office, or the backup notice."""
    heading = f"An outing request has waited {minutes} minutes"
    return notice_email(
        Notice(
            kind="request_waiting",
            to=to,
            subject=f"Lumiback: {heading.lower()}",
            greeting="Hello,",
            label="Waiting",
            tone="neutral",
            heading=heading,
            paragraphs=(
                (
                    "Its hostel's wardens haven't decided it yet. As a head warden, you can "
                    "approve or decline it."
                    if backup
                    else "A student is waiting for the hostel office to approve or decline it."
                ),
            ),
            action=("Open Requests", f"{web_url}/admin/requests"),
            note=None,
            reason=OFFICE_REASON,
            link="text",
        )
    )


def call_me_email(*, to: str, student_id: str, web_url: str) -> Email:
    return notice_email(
        Notice(
            kind="call_me",
            to=to,
            subject="Lumiback: a student who is out asked the office to call them",
            greeting="Hello,",
            label="Call back",
            tone="alert",
            heading="A student asked you to call them",
            paragraphs=(
                "They're out on an outing and their hostel has no office number in Lumiback, "
                "so they asked to be called.",
                "Their phone number is on their record.",
            ),
            action=("Open their record", f"{web_url}/admin/people/{student_id}"),
            note="Add the hostel's number on the Hostel page so students can call you.",
            reason=OFFICE_REASON,
            link="plain",
        )
    )


def office_notice_email(*, to: str, name: str, message: str, recall: bool, web_url: str) -> Email:
    """A notice from the hostel office to a student who is out (or a recall)."""
    heading = "Please come back to the hostel now" if recall else "A notice from the hostel office"
    return notice_email(
        Notice(
            kind="office_notice",
            to=to,
            subject=f"Lumiback: {heading.lower()}",
            greeting=f"Hi {_first(name)},",
            label="Recall" if recall else "Notice",
            tone="alert" if recall else "neutral",
            heading=heading,
            paragraphs=(f"The hostel office says: {message}",),
            action=("Open Lumiback", f"{web_url}/home"),
            note=None,
            reason="you're out on a Lumiback outing",
            link="plain",
        )
    )


@dataclass(frozen=True)
class Fix:
    """One location fix sent with a help alert."""

    lat: float
    lng: float
    accuracy_m: float
    mocked: bool = False

    @property
    def map_url(self) -> str:
        return (
            f"https://www.openstreetmap.org/?mlat={self.lat:.5f}&mlon={self.lng:.5f}"
            f"#map=17/{self.lat:.5f}/{self.lng:.5f}"
        )


def help_office_email(*, to: str, at: datetime, fix: Fix | None, web_url: str) -> Email:
    """To the hostel's wardens and the head wardens: one location fix, no name (who it is,
    and their numbers, are on the Escalations page)."""
    if fix is None:
        where = "Their phone didn't give a location."
    else:
        where = (
            f"Their phone's location then (within about {round(fix.accuracy_m)} m): {fix.map_url}"
        )
        if fix.mocked:
            where += " The phone said this location came from a mock-location app."
    return notice_email(
        Notice(
            kind="help_office",
            to=to,
            subject=f"Lumiback: a student asked for help at {_hhmm(at)} IST",
            greeting="Hello,",
            label="Help",
            tone="alert",
            heading="A student who is out asked for help",
            paragraphs=(
                f"They pressed Help in Lumiback at {_hhmm(at)} IST.",
                where,
                "Who they are and their phone number are on the Escalations page. This is one "
                "location, not tracking.",
            ),
            action=("Open Escalations", f"{web_url}/admin/escalations"),
            note=None,
            reason=OFFICE_REASON,
            link="plain",
        )
    )


def help_contact_email(
    *,
    to: str,
    contact_name: str | None,
    student: str,
    at: datetime,
    phone: str | None,
    office_phone: str | None,
    follower: bool,
) -> Email:
    """To the student's emergency contact, or someone they share their location with who
    doesn't use the app: no location (the office has the one fix)."""
    first = _first(student)
    call = [f"You can call {first} on {phone}." if phone else f"Try calling {first}."]
    if office_phone:
        call.append(f"The hostel office's number is {office_phone}.")
    reason = (
        f"{student} shares their location with you in Lumiback"
        if follower
        else f"{student} gave this address as their emergency contact in Lumiback"
    )
    return notice_email(
        Notice(
            kind="help_contact",
            to=to,
            subject=f"Lumiback: {student} asked for help",
            greeting=f"Hi {_first(contact_name or '')},",
            label="Help",
            tone="alert",
            heading=f"{first} asked for help",
            paragraphs=(
                f"{student} pressed Help in Lumiback at {_hhmm(at)} IST while out of the "
                "hostel. The hostel office has been told.",
                " ".join(call),
            ),
            action=None,
            note=None,
            reason=reason,
        )
    )
