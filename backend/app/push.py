"""Push notifications to the mobile app through Expo's push service.

Expo delivers to Android (via Firebase) with one HTTPS call; tokens come from the app after
sign-in. Tokens Expo reports as DeviceNotRegistered (app uninstalled, token rotated) are deleted.

Sending never blocks a request: endpoints queue it as a background task, and a failure is logged,
not raised. A notification is a nudge; the app always shows the same state when opened.
"""

import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx
from sqlalchemy import delete, exists, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.email import Email, Mailer
from app.models import PushToken, User

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
BATCH = 100  # Expo's per-request limit


@dataclass(frozen=True)
class PushMessage:
    title: str
    body: str
    url: str  # app route to open on tap, e.g. "/live"
    channel: str = "follow-requests"  # Android channel created by the app
    # Safety messages (late alerts, escalations) reach every device, even where the student
    # muted that channel's everyday reminders.
    urgent: bool = False


class PushSender(Protocol):
    async def send(self, tokens: list[str], message: PushMessage) -> set[str]:
        """Deliver to each token; returns the tokens that are no longer valid."""
        ...


class LogPushSender:
    """Development: log instead of sending."""

    async def send(self, tokens: list[str], message: PushMessage) -> set[str]:
        logger.info("push to %d device(s): %s", len(tokens), message.title)
        return set()


@dataclass
class MemoryPushSender:
    """Tests: keep what would have been sent."""

    outbox: list[tuple[list[str], PushMessage]] = field(default_factory=list)
    dead: set[str] = field(default_factory=set)

    async def send(self, tokens: list[str], message: PushMessage) -> set[str]:
        self.outbox.append((tokens, message))
        return {t for t in tokens if t in self.dead}


class ExpoPushSender:
    def __init__(self, access_token: str | None, transport: httpx.AsyncBaseTransport | None = None):
        self._headers = {"Accept": "application/json", "Content-Type": "application/json"}
        if access_token:
            self._headers["Authorization"] = f"Bearer {access_token}"
        self._transport = transport

    async def send(self, tokens: list[str], message: PushMessage) -> set[str]:
        dead: set[str] = set()
        async with httpx.AsyncClient(timeout=10, transport=self._transport) as client:
            for start in range(0, len(tokens), BATCH):
                chunk = tokens[start : start + BATCH]
                payload: list[dict[str, Any]] = [
                    {
                        "to": token,
                        "title": message.title,
                        "body": message.body,
                        "data": {"url": message.url},
                        "sound": "default",
                        "priority": "high",
                        "channelId": message.channel,
                    }
                    for token in chunk
                ]
                response = await client.post(EXPO_PUSH_URL, json=payload, headers=self._headers)
                response.raise_for_status()
                for token, ticket in zip(chunk, response.json().get("data", []), strict=False):
                    error = (ticket.get("details") or {}).get("error")
                    if ticket.get("status") == "error" and error == "DeviceNotRegistered":
                        dead.add(token)
        return dead


def make_push_sender(settings: Settings) -> PushSender:
    if settings.push_backend == "expo":
        token = settings.expo_access_token
        return ExpoPushSender(token.get_secret_value() if token else None)
    return LogPushSender()


async def notify_user(
    sessionmaker: async_sessionmaker[AsyncSession],
    sender: PushSender,
    user_id: uuid.UUID,
    message: PushMessage,
) -> None:
    """Send to every device the user is signed in on. Safe to run as a background task."""
    query = select(PushToken.token).where(PushToken.user_id == user_id)
    if not message.urgent:  # muted on that phone (urgent safety messages still go through)
        query = query.where(~PushToken.muted.contains([message.channel]))
    try:
        async with sessionmaker() as session:
            tokens = list(await session.scalars(query))
            if not tokens:
                return
            dead = await sender.send(tokens, message)
            if dead:
                await session.execute(delete(PushToken).where(PushToken.token.in_(dead)))
                await session.commit()
    except Exception:
        logger.exception("push to user %s failed", user_id)


async def notify_or_email(
    sessionmaker: async_sessionmaker[AsyncSession],
    sender: PushSender | None,
    mailer: Mailer | None,
    user_id: uuid.UUID,
    message: PushMessage,
    email: Callable[[User], Email],
) -> None:
    """Push to the user's phones; a student with no app on any phone (website only, e.g. an
    iPhone) gets `email(user)` instead. Someone who has the app but muted this kind of
    notification is not emailed: muting is their choice. Safe to run as a background task."""
    try:
        async with sessionmaker() as session:
            user = await session.get(User, user_id)
            has_app = await session.scalar(select(exists().where(PushToken.user_id == user_id)))
    except Exception:
        logger.exception("notify user %s failed", user_id)
        return
    if user is None:
        return
    if has_app:
        if sender is not None:
            await notify_user(sessionmaker, sender, user_id, message)
        return
    if mailer is None:
        return
    try:
        await mailer.send(email(user))
    except Exception:
        logger.exception("notice email to user %s failed", user_id)
