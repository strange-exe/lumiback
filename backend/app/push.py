"""Push notifications to the mobile app through Expo's push service.

Expo delivers to Android (via Firebase) with one HTTPS call; tokens come from the app after
sign-in. Delivery has two steps (https://docs.expo.dev/push-notifications/sending-notifications/):

1. Send: Expo answers each message with a ticket. An "ok" ticket only means Expo accepted it;
   an "error" ticket (e.g. DeviceNotRegistered: app uninstalled, token rotated) failed at once.
2. Receipt: about 15 minutes later Expo knows whether Firebase took it. The ticket's id fetches
   that receipt, which can again say DeviceNotRegistered. Expo clears receipts after 24 hours.

Ticket ids are stored in `push_tickets`, so a restart or the free tier's sleep doesn't lose
them; the expiry sweep calls `check_receipts`. Tokens Expo reports as DeviceNotRegistered, on a
ticket or a receipt, are deleted. Other errors are logged.

Sending never blocks a request: endpoints queue it as a background task, and a failure is logged,
not raised. A notification is a nudge; the app always shows the same state when opened.
"""

import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable, Collection
from dataclasses import dataclass, field
from dataclasses import fields as dataclass_fields
from datetime import datetime, timedelta
from typing import Any, Protocol

import httpx
from sqlalchemy import delete, exists, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.email import Email, Mailer
from app.models import PushTicket, PushToken, User, UserRole

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts"
BATCH = 100  # Expo: "an array of up to 100 message objects" per send request
RECEIPT_BATCH = 1000  # Expo: more than 1000 ids in one request is PUSH_TOO_MANY_RECEIPTS

# Expo: on network errors, HTTP 429 or 5xx, "use exponential backoff" and retry. A 400 is a bad
# payload and is never retried. Bounded: 3 tries with 1 s then 2 s between, so a dead push
# service costs a send at most ~33 s (10 s timeout each). A timed-out request may have reached
# Expo, so a retry can deliver twice: a repeated nudge beats a lost late-student alert.
TIMEOUT_SECONDS = 10.0
ATTEMPTS = 3
BACKOFF_SECONDS = 1.0
MAX_BACKOFF_SECONDS = 8.0  # also caps a Retry-After header

# Expo: "We recommend checking push receipts 15 minutes after sending"; "push receipts are
# cleared after 24 hours". A ticket Expo has no receipt for yet is asked about again hourly,
# then dropped once the receipt can no longer exist.
RECEIPT_DELAY = timedelta(minutes=15)
RECEIPT_RECHECK = timedelta(hours=1)
RECEIPT_MAX_AGE = timedelta(hours=24)

GONE = "DeviceNotRegistered"

# How long a message is worth delivering (Expo `ttl`, seconds; Expo's default is 4 weeks).
HOUR = 3600
DAY = 24 * HOUR


@dataclass(frozen=True)
class PushMessage:
    """One notification. Every message the API builds names a `tag` and a `ttl` (wave 5;
    tests/test_push.py checks): a repeat of the same thing replaces the one shown, and a stale
    alert isn't delivered days late. `subtitle` doesn't exist on purpose: Android drops it."""

    title: str
    body: str
    url: str | None = None  # app route to open on tap, e.g. "/live"; None: the app's default
    channel: str = "follow-requests"  # Android channel created by the app
    # Safety messages (late alerts, escalations) reach every device, even where the student
    # muted that channel's everyday reminders.
    urgent: bool = False
    # What the app does on tap besides opening `url`: "app-update" checks for the update.
    kind: str | None = None
    # Android: a notification with the same tag replaces the one already shown.
    tag: str | None = None
    # A notification category the app created (its action buttons), e.g. "app_update".
    category: str | None = None
    # An https picture for the expanded notification (only the website's own banners).
    image: str | None = None
    ttl: int | None = None  # seconds Expo may keep trying to deliver it

    @classmethod
    def from_saved(cls, saved: dict[str, Any]) -> "PushMessage":
        """A message the outbox saved (dataclasses.asdict). Fields this version doesn't know
        (saved by a newer one, then rolled back) are dropped, so the alert is still sent."""
        known = {f.name for f in dataclass_fields(cls)}
        return cls(**{k: v for k, v in saved.items() if k in known})


@dataclass
class SendResult:
    """What became of each token in one send."""

    tickets: dict[str, str] = field(default_factory=dict)  # Expo accepted: ticket id -> token
    dead: set[str] = field(default_factory=set)  # DeviceNotRegistered: delete the token
    failed: set[str] = field(default_factory=set)  # any other error, after retries

    @property
    def accepted(self) -> set[str]:
        return set(self.tickets.values())


class PushSender(Protocol):
    async def send(self, tokens: list[str], message: PushMessage) -> SendResult:
        """Deliver to each token. Never raises for one bad batch: its tokens are `failed`."""
        ...

    async def receipts(self, ticket_ids: list[str]) -> dict[str, dict[str, Any]]:
        """Expo's receipts by ticket id; ids without a receipt yet are left out."""
        ...


class LogPushSender:
    """Development: log instead of sending."""

    async def send(self, tokens: list[str], message: PushMessage) -> SendResult:
        # Counts only: a title or body can name a student or where they are.
        logger.info("push to %d device(s)", len(tokens))
        return SendResult()

    async def receipts(self, ticket_ids: list[str]) -> dict[str, dict[str, Any]]:
        return {}


@dataclass
class MemoryPushSender:
    """Tests: keep what would have been sent. Every live token gets a ticket; set `receipts_by_id`
    to what Expo would answer for a ticket later."""

    outbox: list[tuple[list[str], PushMessage]] = field(default_factory=list)
    dead: set[str] = field(default_factory=set)
    receipts_by_id: dict[str, dict[str, Any]] = field(default_factory=dict)
    receipt_requests: list[list[str]] = field(default_factory=list)

    async def send(self, tokens: list[str], message: PushMessage) -> SendResult:
        self.outbox.append((tokens, message))
        result = SendResult(dead={t for t in tokens if t in self.dead})
        for token in tokens:
            if token not in result.dead:
                result.tickets[str(uuid.uuid4())] = token
        return result

    async def receipts(self, ticket_ids: list[str]) -> dict[str, dict[str, Any]]:
        self.receipt_requests.append(list(ticket_ids))
        return {i: self.receipts_by_id[i] for i in ticket_ids if i in self.receipts_by_id}


class PushServiceError(Exception):
    """Expo refused a whole request (its top-level `errors`)."""


class ExpoPushSender:
    def __init__(
        self,
        access_token: str | None,
        transport: httpx.AsyncBaseTransport | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ):
        self._headers = {"Accept": "application/json", "Content-Type": "application/json"}
        if access_token:
            self._headers["Authorization"] = f"Bearer {access_token}"
        self._transport = transport
        self._sleep = sleep  # tests skip the real waits

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=TIMEOUT_SECONDS, transport=self._transport)

    async def _post(self, client: httpx.AsyncClient, url: str, body: Any) -> Any:
        """POST with bounded retries on transport errors, 429 and 5xx; returns the JSON body."""
        for attempt in range(1, ATTEMPTS + 1):
            wait = min(BACKOFF_SECONDS * 2 ** (attempt - 1), MAX_BACKOFF_SECONDS)
            try:
                response = await client.post(url, json=body, headers=self._headers)
            except httpx.TransportError as error:  # connect/read errors and timeouts
                if attempt == ATTEMPTS:
                    raise
                logger.warning("push service unreachable (%s), retrying", type(error).__name__)
            else:
                if response.status_code != 429 and response.status_code < 500:
                    response.raise_for_status()  # 4xx: a bad request, retrying won't help
                    payload = response.json()
                    if not payload.get("data") and payload.get("errors"):
                        codes = [e.get("code") for e in payload["errors"]]
                        raise PushServiceError(f"push service refused the request: {codes}")
                    return payload
                if attempt == ATTEMPTS:
                    response.raise_for_status()
                logger.warning("push service answered %d, retrying", response.status_code)
                wait = _retry_after(response, wait)
            await self._sleep(wait)
        raise AssertionError("unreachable")  # pragma: no cover

    async def send(self, tokens: list[str], message: PushMessage) -> SendResult:
        result = SendResult()
        async with self._client() as client:
            for start in range(0, len(tokens), BATCH):
                chunk = tokens[start : start + BATCH]
                payload: list[dict[str, Any]] = [
                    {"to": token, **_fields(message)} for token in chunk
                ]
                try:
                    tickets = (await self._post(client, EXPO_PUSH_URL, payload)).get("data", [])
                except Exception:
                    # One batch failing (after retries) doesn't stop the others.
                    logger.exception("push to %d device(s) failed", len(chunk))
                    result.failed.update(chunk)
                    continue
                # Tickets come back in the order the messages were sent.
                for index, token in enumerate(chunk):
                    ticket = tickets[index] if index < len(tickets) else {}
                    error = (ticket.get("details") or {}).get("error")
                    if ticket.get("status") == "ok" and ticket.get("id"):
                        result.tickets[ticket["id"]] = token
                    elif ticket.get("status") == "error" and error == GONE:
                        result.dead.add(token)
                    else:
                        # MessageTooBig, MessageRateExceeded, MismatchSenderId,
                        # InvalidCredentials, or a missing ticket. The token stays.
                        logger.warning("push ticket error: %s %s", error, ticket.get("message"))
                        result.failed.add(token)
        return result

    async def receipts(self, ticket_ids: list[str]) -> dict[str, dict[str, Any]]:
        found: dict[str, dict[str, Any]] = {}
        async with self._client() as client:
            for start in range(0, len(ticket_ids), RECEIPT_BATCH):
                ids = ticket_ids[start : start + RECEIPT_BATCH]
                payload = await self._post(client, EXPO_RECEIPTS_URL, {"ids": ids})
                found.update(payload.get("data") or {})
        return found


def _fields(message: PushMessage) -> dict[str, Any]:
    """The Expo message, without `to` (docs.expo.dev/push-notifications/sending-notifications)."""
    fields: dict[str, Any] = {
        "title": message.title,
        "body": message.body,
        "data": _data(message),
        "sound": "default",
        "priority": "high",
        "channelId": message.channel,
    }
    if message.tag:
        fields["tag"] = message.tag
    if message.category:
        fields["categoryId"] = message.category
    if message.image:
        fields["richContent"] = {"image": message.image}
    if message.ttl is not None:
        fields["ttl"] = message.ttl
    return fields


def _data(message: PushMessage) -> dict[str, str]:
    data = {}
    if message.url:
        data["url"] = message.url
    if message.kind:
        data["kind"] = message.kind
    return data


def _retry_after(response: httpx.Response, default: float) -> float:
    try:
        seconds = float(response.headers.get("Retry-After", ""))
    except ValueError:
        return default
    return min(max(seconds, 0.0), MAX_BACKOFF_SECONDS)


def make_push_sender(settings: Settings) -> PushSender:
    if settings.push_backend == "expo":
        token = settings.expo_access_token
        return ExpoPushSender(token.get_secret_value() if token else None)
    return LogPushSender()


@dataclass(frozen=True)
class PushOutcome:
    devices: int = 0  # phones it was for (not muted, or urgent)
    accepted: int = 0  # Expo took it
    failed: int = 0  # any error but DeviceNotRegistered (worth trying again later)


async def push_devices(
    sessionmaker: async_sessionmaker[AsyncSession],
    sender: PushSender,
    user_id: uuid.UUID,
    message: PushMessage,
) -> PushOutcome:
    """Send to every device the user is signed in on; raises if the database can't be read
    (the outbox then tries again). Dead tokens are deleted, accepted tickets kept for the
    receipt check."""
    query = select(PushToken.token).where(PushToken.user_id == user_id)
    if not message.urgent:  # muted on that phone (urgent safety messages still go through)
        query = query.where(~PushToken.muted.contains([message.channel]))
    async with sessionmaker() as session:
        tokens = list(await session.scalars(query))
        if not tokens:
            return PushOutcome()
        result = await sender.send(tokens, message)
        if result.dead:
            await session.execute(delete(PushToken).where(PushToken.token.in_(result.dead)))
        if result.tickets:  # the sweep fetches their receipts later
            await session.execute(
                insert(PushTicket)
                .values([{"id": i, "token": t} for i, t in result.tickets.items()])
                .on_conflict_do_nothing()
            )
        await session.commit()
        return PushOutcome(len(tokens), len(result.accepted), len(result.failed))


async def notify_user(
    sessionmaker: async_sessionmaker[AsyncSession],
    sender: PushSender,
    user_id: uuid.UUID,
    message: PushMessage,
) -> int:
    """Send to every device the user is signed in on. Safe to run as a background task.
    Returns how many devices Expo accepted it for (0 if none were eligible, all were dead, or
    the send failed)."""
    try:
        return (await push_devices(sessionmaker, sender, user_id, message)).accepted
    except Exception:
        logger.exception("push to user %s failed", user_id)
        return 0


TICKET_INSERT_BATCH = 1000


def _everyone(channel: str, roles: Collection[UserRole] | None):  # noqa: ANN202 - a WHERE list
    """Phones of accounts that are on, not muting `channel`; with `roles`, those roles only."""
    where = [User.deactivated_at.is_(None), ~PushToken.muted.contains([channel])]
    if roles is not None:
        where.append(User.role.in_(roles))
    return where


async def push_everyone(
    sessionmaker: async_sessionmaker[AsyncSession],
    sender: PushSender,
    message: PushMessage,
    roles: Collection[UserRole] | None = None,
) -> PushOutcome:
    """One message to every phone with the app (accounts that are on; phones that muted the
    channel skipped), or only to people with one of `roles`, in Expo's batches. Only the
    developer's "Announce update" calls this (api/admin.py): nothing sends it on its own. Safe
    as a background task: failures are logged, not raised."""
    try:
        async with sessionmaker() as session:
            tokens = list(
                await session.scalars(
                    select(PushToken.token)
                    .join(User, User.id == PushToken.user_id)
                    .where(*_everyone(message.channel, roles))
                )
            )
            if not tokens:
                return PushOutcome()
            result = await sender.send(tokens, message)
            if result.dead:
                await session.execute(delete(PushToken).where(PushToken.token.in_(result.dead)))
            tickets = [{"id": i, "token": t} for i, t in result.tickets.items()]
            for start in range(0, len(tickets), TICKET_INSERT_BATCH):
                await session.execute(
                    insert(PushTicket)
                    .values(tickets[start : start + TICKET_INSERT_BATCH])
                    .on_conflict_do_nothing()
                )
            await session.commit()
            return PushOutcome(len(tokens), len(result.accepted), len(result.failed))
    except Exception:
        logger.exception("push to every device failed")
        return PushOutcome()


async def count_everyone(
    session: AsyncSession, channel: str, roles: Collection[UserRole] | None = None
) -> int:
    """How many phones push_everyone would send to now."""
    count = await session.scalar(
        select(func.count())
        .select_from(PushToken)
        .join(User, User.id == PushToken.user_id)
        .where(*_everyone(channel, roles))
    )
    return count or 0


@dataclass(frozen=True)
class ReceiptCheck:
    checked: int = 0  # tickets asked about
    delivered: int = 0  # receipt "ok"
    pruned: int = 0  # tokens deleted: DeviceNotRegistered
    errors: int = 0  # other receipt errors (logged)
    expired: int = 0  # dropped: older than Expo keeps receipts


async def check_receipts(
    sessionmaker: async_sessionmaker[AsyncSession], sender: PushSender, now: datetime
) -> ReceiptCheck:
    """Ask Expo about tickets that are old enough to have a receipt, at most RECEIPT_BATCH per
    call (the sweep runs every 30 s, so that keeps up). Raises if Expo can't be reached; the
    tickets then stay for the next sweep. Safe to run from several instances at once."""
    async with sessionmaker() as session:
        expired = await session.execute(
            delete(PushTicket).where(PushTicket.created_at < now - RECEIPT_MAX_AGE)
        )
        due = [
            (ticket_id, token)
            for ticket_id, token in await session.execute(
                select(PushTicket.id, PushTicket.token)
                .where(
                    PushTicket.created_at <= now - RECEIPT_DELAY,
                    or_(
                        PushTicket.checked_at.is_(None),
                        PushTicket.checked_at <= now - RECEIPT_RECHECK,
                    ),
                )
                .order_by(PushTicket.created_at)
                .limit(RECEIPT_BATCH)
            )
        ]
        await session.commit()
    if expired.rowcount:
        logger.warning("dropped %d push ticket(s) Expo never confirmed", expired.rowcount)
    if not due:
        return ReceiptCheck(expired=expired.rowcount)

    # No database connection is held while Expo answers.
    receipts = await sender.receipts([ticket_id for ticket_id, _ in due])

    answered: list[str] = []
    gone: set[str] = set()
    delivered = errors = 0
    for ticket_id, token in due:
        receipt = receipts.get(ticket_id)
        if receipt is None:
            continue
        answered.append(ticket_id)
        if receipt.get("status") == "ok":
            delivered += 1
            continue
        error = (receipt.get("details") or {}).get("error")
        if error == GONE:
            gone.add(token)
        else:
            errors += 1
            logger.warning("push receipt %s error: %s %s", ticket_id, error, receipt.get("message"))
    waiting = [ticket_id for ticket_id, _ in due if ticket_id not in receipts]
    async with sessionmaker() as session:
        if answered:
            await session.execute(delete(PushTicket).where(PushTicket.id.in_(answered)))
        if waiting:
            await session.execute(
                update(PushTicket).where(PushTicket.id.in_(waiting)).values(checked_at=now)
            )
        pruned = 0
        if gone:
            pruned = (
                await session.execute(delete(PushToken).where(PushToken.token.in_(gone)))
            ).rowcount
        await session.commit()
    return ReceiptCheck(
        checked=len(due),
        delivered=delivered,
        pruned=pruned,
        errors=errors,
        expired=expired.rowcount,
    )


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
    notification is not emailed: muting is their choice. An urgent message that reached no
    phone (every token gone, or the push service failed) is emailed too: a safety alert must
    land somewhere. Safe to run as a background task."""
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
        delivered = (
            await notify_user(sessionmaker, sender, user_id, message) if sender is not None else 0
        )
        if delivered or not message.urgent:
            return
    if mailer is None:
        return
    try:
        await mailer.send(email(user))
    except Exception:
        logger.exception("notice email to user %s failed", user_id)
