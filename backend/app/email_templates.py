"""Transactional email templates in the app's "Dusk Courtyard" style.

Email clients are not browsers: Outlook (Graphic Era's mail) renders with Word's engine,
blocks remote images by default, and ignores web fonts. So these templates use tables,
inline styles, system fonts (Georgia stands in for Fraunces), no images, and no links.
Every user-supplied value is HTML-escaped.
"""

from html import escape

from app.email import Email

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


def _frame(*, preheader: str, title: str, body_html: str) -> str:
    """Shared shell: hidden preheader, wordmark, card, footer. Light and dark aware."""
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
    .card {{ background: #1a2421 !important; border-color: #2d3935 !important; }}
    .ink {{ color: #ede7dc !important; }}
    .stone {{ color: #a9aea6 !important; }}
    .pine {{ color: #8fc1b5 !important; }}
    .code {{ background: #1f3530 !important; color: #ede7dc !important; }}
    .rule {{ border-top-color: #2d3935 !important; }}
  }}
</style>
</head>
<body class="bg" style="margin:0;padding:0;background:{MIST};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{escape(preheader)}</div>
<table role="presentation" class="bg" width="100%" cellpadding="0" cellspacing="0" style="background:{MIST};">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
    <tr><td class="pine" style="padding:0 4px 16px;font-family:{SERIF};font-size:22px;color:{PINE};"><span style="color:{LANTERN};font-size:14px;vertical-align:3px;">&#9679;</span>&nbsp;Lumiback</td></tr>
    <tr><td class="card" style="background:{SURFACE};border:1px solid {LINE};border-radius:16px;padding:32px 28px;">
{body_html}
    </td></tr>
    <tr><td class="stone" style="padding:20px 4px 0;font-family:{SANS};font-size:12px;line-height:18px;color:{STONE};">
      Lumiback &middot; for Graphic Era hostel students<br>
      You're receiving this because this address was used to create a Lumiback account.
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>"""


def verification_email(*, to: str, name: str, code: str, minutes: int) -> Email:
    first = name.split()[0] if name.split() else "there"
    text = (
        f"Hi {first},\n\n"
        f"Your Lumiback verification code is {code}.\n"
        f"It expires in {minutes} minutes.\n\n"
        "If you did not create a Lumiback account, you can ignore this email. "
        "Nobody can use the account without this code.\n"
    )
    body = f"""
      <p class="stone" style="margin:0 0 4px;font-family:{SERIF};font-size:17px;color:{STONE};">Hi {escape(first)},</p>
      <h1 class="ink" style="margin:0 0 20px;font-family:{SERIF};font-size:26px;line-height:32px;font-weight:normal;color:{INK};">Confirm your university email</h1>
      <p class="ink" style="margin:0 0 16px;font-family:{SANS};font-size:15px;line-height:22px;color:{INK};">Enter this code in Lumiback to finish creating your account:</p>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
        <td class="code" align="center" style="background:{PINE_SOFT};border-radius:12px;padding:18px 8px;font-family:{MONO};font-size:34px;line-height:40px;letter-spacing:10px;font-weight:bold;color:{PINE};">{code}</td>
      </tr></table>
      <p class="stone" style="margin:16px 0 0;font-family:{SANS};font-size:14px;line-height:20px;color:{STONE};">It expires in {minutes} minutes.</p>
      <hr class="rule" style="border:none;border-top:1px solid {LINE};margin:24px 0;">
      <p class="stone" style="margin:0;font-family:{SANS};font-size:13px;line-height:19px;color:{STONE};">Didn't create an account? You can ignore this email. Nobody can use the account without this code.</p>"""
    return Email(
        to=to,
        subject=f"{code} is your Lumiback code",
        body=text,
        html=_frame(
            preheader=f"Your code expires in {minutes} minutes.",
            title="Your Lumiback code",
            body_html=body,
        ),
    )
