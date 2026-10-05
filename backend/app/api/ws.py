"""Live location over WebSocket (PLAN §4.6).

Protocol (JSON messages):
  client -> {"type": "auth", "token": "<access JWT>"} | {"type": "auth", "guest_token": "..."}
            must be the first message, within AUTH_TIMEOUT seconds        (else close 4401)
  server -> {"type": "ready"}
  client -> {"type": "subscribe", "session_id": "..."} / {"type": "unsubscribe", ...}
  server -> {"type": "subscribed", "session_id", "location"} | {"type": "pending", "session_id"}
            {"type": "granted", ...} | {"type": "location", ...} | {"type": "ended", "reason"}

Authorization is re-checked against the database for EVERY event before anything is sent,
so a revoked, expired, or stopped viewer never receives another location. Close codes:
4400 protocol error, 4401 not authenticated / token expired, 4403 access ended, 4404 unknown.
"""

import asyncio
import json
import logging
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from app.models import AccessChannel, SessionStatus, User
from app.realtime import Event, Hub, LocationUpdated
from app.security.codes import hash_guest_token
from app.security.tokens import InvalidToken, decode_access_token
from app.services import locations as loc_svc
from app.services.authz import Access, Principal, Role, is_live, resolve_access

router = APIRouter()
logger = logging.getLogger(__name__)

AUTH_TIMEOUT = 5.0
MAX_SUBSCRIPTIONS = 10
MAX_MESSAGE_BYTES = 4096

CLOSE_PROTOCOL = 4400
CLOSE_UNAUTHENTICATED = 4401
CLOSE_ACCESS_ENDED = 4403
CLOSE_NOT_FOUND = 4404


def _location_json(loc) -> dict | None:
    return loc.model_dump(mode="json") if loc else None


def _ended_reason(access: Access) -> str:
    share = access.share
    if share is not None and share.status != SessionStatus.ACTIVE:
        return share.ended_reason or share.status.value
    if share is not None and not is_live(share, datetime.now(UTC)):
        return "expired"
    if access.viewer is not None:
        return access.viewer.status.value  # e.g. "revoked"
    return "ended"


class Connection:
    def __init__(
        self,
        websocket: WebSocket,
        principal: Principal,
        token_expires_at: datetime | None,
    ) -> None:
        self.ws = websocket
        self.app = websocket.app
        self.hub: Hub = websocket.app.state.hub
        self.principal = principal
        self.token_expires_at = token_expires_at
        self.subscriptions: dict[uuid.UUID, object] = {}
        self.pending: set[uuid.UUID] = set()
        self._send_lock = asyncio.Lock()
        self.closed = False

    # ---------- plumbing ----------

    async def send(self, message: dict) -> None:
        async with self._send_lock:
            if not self.closed and self.ws.application_state == WebSocketState.CONNECTED:
                await self.ws.send_json(message)

    async def close(self, code: int, reason: str = "") -> None:
        if self.closed:
            return
        self.closed = True
        self.unsubscribe_all()
        async with self._send_lock:
            if self.ws.application_state == WebSocketState.CONNECTED:
                await self.ws.close(code=code, reason=reason)

    def token_expired(self) -> bool:
        return self.token_expires_at is not None and datetime.now(UTC) >= self.token_expires_at

    async def _check(self, session_id: uuid.UUID) -> tuple[Access, dict | None]:
        """Fresh DB session per check: never trust cached authorization."""
        async with self.app.state.sessionmaker() as db:
            access = await resolve_access(db, session_id, self.principal)
            location = None
            if access.role in (Role.SHARER, Role.VIEWER):
                location = _location_json(await loc_svc.latest(db, session_id))
            return access, location

    async def _log(self, session_id: uuid.UUID, access: Access) -> None:
        if access.role is Role.VIEWER and access.viewer is not None:
            async with self.app.state.sessionmaker() as db:
                await loc_svc.log_access(db, session_id, access.viewer.id, AccessChannel.WS)

    # ---------- client requests ----------

    async def subscribe(self, session_id: uuid.UUID) -> None:
        if session_id in self.subscriptions:
            return
        if len(self.subscriptions) >= MAX_SUBSCRIPTIONS:
            await self.send({"type": "error", "detail": "too many subscriptions"})
            return
        access, location = await self._check(session_id)
        match access.role:
            case Role.SHARER | Role.VIEWER:
                self._attach(session_id)
                await self._log(session_id, access)
                await self.send(
                    {"type": "subscribed", "session_id": str(session_id), "location": location}
                )
            case Role.PENDING:
                self._attach(session_id)
                self.pending.add(session_id)
                await self.send({"type": "pending", "session_id": str(session_id)})
            case Role.FORMER_VIEWER:
                await self.send(
                    {
                        "type": "ended",
                        "session_id": str(session_id),
                        "reason": _ended_reason(access),
                    }
                )
                if not self.subscriptions:
                    await self.close(CLOSE_ACCESS_ENDED, "access ended")
            case _:
                await self.send({"type": "error", "detail": "session not found"})
                if not self.subscriptions:
                    await self.close(CLOSE_NOT_FOUND, "session not found")

    def _attach(self, session_id: uuid.UUID) -> None:
        async def on_event(event: Event) -> None:
            await self.deliver(session_id, event)

        self.subscriptions[session_id] = on_event
        self.hub.subscribe(session_id, on_event)

    def unsubscribe(self, session_id: uuid.UUID) -> None:
        handler = self.subscriptions.pop(session_id, None)
        self.pending.discard(session_id)
        if handler is not None:
            self.hub.unsubscribe(session_id, handler)  # type: ignore[arg-type]

    def unsubscribe_all(self) -> None:
        for session_id in list(self.subscriptions):
            self.unsubscribe(session_id)

    # ---------- server events ----------

    async def deliver(self, session_id: uuid.UUID, event: Event) -> None:
        """Called for every hub event. Re-authorizes before sending anything."""
        if self.closed:
            return
        if self.token_expired():
            await self.send({"type": "reauth_required"})
            await self.close(CLOSE_UNAUTHENTICATED, "token expired")
            return

        access, location = await self._check(session_id)
        if access.role in (Role.SHARER, Role.VIEWER):
            if session_id in self.pending:  # just approved
                self.pending.discard(session_id)
                await self._log(session_id, access)
                await self.send(
                    {"type": "granted", "session_id": str(session_id), "location": location}
                )
            elif isinstance(event, LocationUpdated):
                await self.send(
                    {"type": "location", "session_id": str(session_id), "location": location}
                )
            return
        if access.role is Role.PENDING:
            return  # still waiting; nothing to send

        # Access is gone (stopped, expired, revoked, contact removed, or no longer exists).
        self.unsubscribe(session_id)
        await self.send(
            {"type": "ended", "session_id": str(session_id), "reason": _ended_reason(access)}
        )
        if not self.subscriptions:
            await self.close(CLOSE_ACCESS_ENDED, "access ended")


async def _authenticate(websocket: WebSocket, message: dict) -> Connection | None:
    if message.get("type") != "auth":
        return None
    settings = websocket.app.state.settings
    if isinstance(token := message.get("token"), str):
        try:
            claims = decode_access_token(token, settings.jwt_secret.get_secret_value())
        except InvalidToken:
            return None
        async with websocket.app.state.sessionmaker() as db:
            if await db.get(User, claims.user_id) is None:
                return None
        return Connection(websocket, Principal(user_id=claims.user_id), claims.expires_at)
    if isinstance(guest := message.get("guest_token"), str) and 0 < len(guest) <= 200:
        return Connection(websocket, Principal(guest_token_hash=hash_guest_token(guest)), None)
    return None


async def _receive(websocket: WebSocket) -> dict:
    raw = await websocket.receive_text()
    if len(raw) > MAX_MESSAGE_BYTES:
        raise ValueError("message too large")
    message = json.loads(raw)
    if not isinstance(message, dict):
        raise ValueError("message must be a JSON object")
    return message


@router.websocket("/ws")
async def live(websocket: WebSocket) -> None:
    # CORS does not apply to WebSockets: check Origin ourselves. Native apps send none.
    origin = websocket.headers.get("origin")
    if origin is not None and origin.rstrip("/") not in websocket.app.state.settings.cors_origins:
        await websocket.close(code=1008)  # before accept -> handshake rejected
        return
    await websocket.accept()

    try:
        first = await asyncio.wait_for(_receive(websocket), AUTH_TIMEOUT)
    except (TimeoutError, ValueError, WebSocketDisconnect):
        if websocket.application_state == WebSocketState.CONNECTED:
            await websocket.close(code=CLOSE_UNAUTHENTICATED, reason="authenticate first")
        return

    conn = await _authenticate(websocket, first)
    if conn is None:
        await websocket.close(code=CLOSE_UNAUTHENTICATED, reason="invalid credentials")
        return
    await conn.send({"type": "ready"})

    try:
        while not conn.closed:
            try:
                message = await _receive(websocket)
                kind = message.get("type")
                session_id = uuid.UUID(str(message.get("session_id")))
            except (ValueError, TypeError):
                await conn.close(CLOSE_PROTOCOL, "malformed message")
                break
            if conn.token_expired():
                await conn.close(CLOSE_UNAUTHENTICATED, "token expired")
                break
            if kind == "subscribe":
                await conn.subscribe(session_id)
            elif kind == "unsubscribe":
                conn.unsubscribe(session_id)
                await conn.send({"type": "unsubscribed", "session_id": str(session_id)})
            else:
                await conn.close(CLOSE_PROTOCOL, "unknown message type")
    except WebSocketDisconnect:
        pass
    finally:
        conn.unsubscribe_all()
        conn.closed = True
