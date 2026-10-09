"""Outgoing email: Resend's HTTPS API, or SMTP with any provider (Brevo, Workspace, SES, ...).

Prefer the HTTPS API on hosts that block outbound SMTP ports (Render's free plan does)."""

import asyncio
import logging
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Protocol

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Email:
    to: str
    subject: str
    body: str  # plain text: always sent, and what tests and the console read
    html: str | None = None  # optional rich version, sent as multipart/alternative


def build_message(email: Email, sender: str, reply_to: str | None = None) -> EmailMessage:
    message = EmailMessage()
    message["From"] = sender
    message["To"] = email.to
    if reply_to:
        message["Reply-To"] = reply_to
    message["Subject"] = email.subject
    message.set_content(email.body)
    if email.html:
        message.add_alternative(email.html, subtype="html")
    return message


class Mailer(Protocol):
    async def send(self, email: Email) -> None: ...


class ConsoleMailer:
    """Development only (settings refuse it in production): prints instead of sending."""

    async def send(self, email: Email) -> None:
        logger.warning("DEV EMAIL to %s | %s\n%s", email.to, email.subject, email.body)


class MemoryMailer:
    """Tests: keeps messages so a test can read the code it would have received."""

    def __init__(self) -> None:
        self.outbox: list[Email] = []

    async def send(self, email: Email) -> None:
        self.outbox.append(email)


class SmtpMailer:
    def __init__(self, settings: Settings) -> None:
        assert settings.smtp_host and settings.smtp_username and settings.smtp_password
        assert settings.email_from
        self._host = settings.smtp_host
        self._port = settings.smtp_port
        self._username = settings.smtp_username
        self._password = settings.smtp_password
        self._from = settings.email_from
        self._reply_to = settings.email_reply_to

    def _send_blocking(self, email: Email) -> None:
        message = build_message(email, self._from, self._reply_to)
        context = ssl.create_default_context()  # verifies the server certificate
        if self._port == 465:
            server: smtplib.SMTP = smtplib.SMTP_SSL(
                self._host, self._port, context=context, timeout=15
            )
        else:
            server = smtplib.SMTP(self._host, self._port, timeout=15)
            server.starttls(context=context)
        with server:
            server.login(self._username, self._password.get_secret_value())
            server.send_message(message)

    async def send(self, email: Email) -> None:
        await asyncio.to_thread(self._send_blocking, email)


class ResendMailer:
    """Resend's REST API over HTTPS (port 443). Raises on any non-success answer."""

    URL = "https://api.resend.com/emails"

    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        assert settings.resend_api_key and settings.email_from
        self._key = settings.resend_api_key
        self._from = settings.email_from
        self._reply_to = settings.email_reply_to
        self._client = client  # injectable for tests

    async def send(self, email: Email) -> None:
        payload = {
            "from": self._from,
            "to": [email.to],
            "subject": email.subject,
            "text": email.body,
        }
        if email.html:
            payload["html"] = email.html
        if self._reply_to:
            payload["reply_to"] = self._reply_to
        headers = {"Authorization": f"Bearer {self._key.get_secret_value()}"}
        if self._client is not None:
            response = await self._client.post(self.URL, json=payload, headers=headers)
        else:
            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.post(self.URL, json=payload, headers=headers)
        if not response.is_success:
            # Resend's error body names the problem (bad key, unverified domain); no secrets in it.
            raise RuntimeError(f"Resend answered {response.status_code}: {response.text[:300]}")


def make_mailer(settings: Settings) -> Mailer:
    match settings.email_backend:
        case "smtp":
            return SmtpMailer(settings)
        case "resend":
            return ResendMailer(settings)
        case _:
            return ConsoleMailer()
