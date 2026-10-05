"""Outgoing email. SMTP works with any provider (Resend, Brevo, Google Workspace, SES, ...)."""

import asyncio
import logging
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Protocol

from app.config import Settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Email:
    to: str
    subject: str
    body: str


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

    def _send_blocking(self, email: Email) -> None:
        message = EmailMessage()
        message["From"] = self._from
        message["To"] = email.to
        message["Subject"] = email.subject
        message.set_content(email.body)
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


def make_mailer(settings: Settings) -> Mailer:
    return SmtpMailer(settings) if settings.email_backend == "smtp" else ConsoleMailer()
