"""Transactional email templates in the app's "Dusk Courtyard" style.

Email clients are not browsers: Outlook (Graphic Era's mail) renders with Word's engine,
blocks remote images by default, and ignores web fonts. So these templates use tables,
inline styles, system fonts (Georgia stands in for Fraunces), no images, and no links.
Every user-supplied value is HTML-escaped.
"""

from datetime import UTC, datetime
from html import escape

from app.email import Email
from app.schemas import IST

PINE = "#234e46"
MIST = "#f4efe6"
SURFACE = "#fbf8f2"
INK = "#1b2422"
STONE = "#5c605a"
LINE = "#e3dccf"
PINE_SOFT = "#dbe7e2"
LANTERN = "#e59a3a"

SERIF = "Georgia, 'Times New Roman', serif"
SANS = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
MONO = "Consolas, 'SF Mono', Menlo, monospace"


def ist_stamp(moment: datetime) -> str:
    """'10:41 PM IST, Tue 6 Oct' (portable: no platform-specific strftime flags)."""
    t = moment.astimezone(IST)
    hour = t.hour % 12 or 12
    period = "AM" if t.hour < 12 else "PM"
    return f"{hour}:{t.minute:02d} {period} IST, {t.strftime('%a')} {t.day} {t.strftime('%b')}"


def _frame(*, preheader: str, title: str, recipient: str, reason: str, body_html: str) -> str:
    """Shared shell: hidden preheader, wordmark, card with lantern bar, footer. Dark aware."""
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>{escape(title)}</title>
<style>
  @media (prefers-color-scheme: dark) {{
    .bg {{ background: #121a18 !important; }}
    .card {{ background: #1a2421 !important; border-color: #2d3935 !important; border-top-color: #f0a94b !important; }}
    .ink {{ color: #ede7dc !important; }}
    .stone {{ color: #a9aea6 !important; }}
    .pine {{ color: #8fc1b5 !important; }}
    .code {{ background: #1f3530 !important; color: #ede7dc !important; border-color: #8fc1b5 !important; }}
    .rule {{ border-top-color: #2d3935 !important; }}
    .note {{ background: #1f2a27 !important; }}
  }}
</style>
</head>
<body class="bg" style="margin:0;padding:0;background:{MIST};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{escape(preheader)}</div>
<table role="presentation" class="bg" width="100%" cellpadding="0" cellspacing="0" style="background:{MIST};">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
    <tr><td class="pine" style="padding:0 4px 16px;font-family:{SERIF};font-size:22px;color:{PINE};"><span style="color:{LANTERN};font-size:14px;vertical-align:3px;">&#9679;</span>&nbsp;Lumiback</td></tr>
    <tr><td class="card" style="background:{SURFACE};border:1px solid {LINE};border-top:4px solid {LANTERN};border-radius:16px;padding:30px 28px 28px;">
{body_html}
    </td></tr>
    <tr><td class="stone" style="padding:20px 4px 0;font-family:{SANS};font-size:12px;line-height:18px;color:{STONE};">
      Sent to {escape(recipient)} &middot; {escape(reason)}<br>
      Lumiback &middot; made for Graphic Era hostel students
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>"""


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
    body = f"""
      <p class="stone" style="margin:0 0 4px;font-family:{SERIF};font-size:17px;color:{STONE};">Hi {escape(first)},</p>
      <h1 class="ink" style="margin:0 0 10px;font-family:{SERIF};font-size:26px;line-height:32px;font-weight:normal;color:{INK};">Confirm your university email</h1>
      <p class="ink" style="margin:0 0 20px;font-family:{SANS};font-size:15px;line-height:22px;color:{INK};">Enter this code in Lumiback to finish creating your account.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
        <td class="code" align="center" style="background:{PINE_SOFT};border:2px dashed {PINE};border-radius:14px;padding:20px 8px 20px 20px;font-family:{MONO};font-size:36px;line-height:42px;letter-spacing:12px;font-weight:bold;color:{PINE};">{code}</td>
      </tr></table>
      <p class="stone" style="margin:12px 0 0;font-family:{SANS};font-size:13px;line-height:19px;color:{STONE};">Expires in {minutes} minutes &middot; requested at {escape(when)}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:22px;"><tr>
        <td class="note ink" style="background:{MIST};border-radius:10px;padding:12px 14px;font-family:{SANS};font-size:13px;line-height:19px;color:{INK};"><strong>Keep it to yourself.</strong> Lumiback will never ask for this code by phone, chat or email.</td>
      </tr></table>
      <hr class="rule" style="border:none;border-top:1px solid {LINE};margin:24px 0 18px;">
      <p class="stone" style="margin:0 0 10px;font-family:{SANS};font-size:13px;line-height:19px;color:{STONE};">Once you're in: check out in two taps, choose who sees your way back, and end it the moment you're home.</p>
      <p class="stone" style="margin:0;font-family:{SANS};font-size:13px;line-height:19px;color:{STONE};">Didn't create an account? Ignore this email. Nobody can use the account without this code.</p>"""
    return Email(
        to=to,
        subject=f"{code} is your Lumiback code",
        body=text,
        html=_frame(
            preheader=f"Expires in {minutes} minutes. Lumiback will never ask you for this code.",
            title="Your Lumiback code",
            recipient=to,
            reason="you started creating a Lumiback account",
            body_html=body,
        ),
    )
