"""Shared request dependencies: DB session, settings, rate limiting, current user."""

import hmac
import ipaddress
import uuid
from collections.abc import Callable
from typing import Annotated

from fastapi import BackgroundTasks, Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db import get_session
from app.email import Email, Mailer
from app.models import User, UserRole
from app.push import PushMessage, notify_or_email, notify_user
from app.realtime import Hub
from app.security.breached import BreachChecker
from app.security.codes import hash_guest_token
from app.security.rate_limit import Limit, RateLimited, RateLimiter
from app.security.tokens import InvalidToken, decode_access_token
from app.services import outbox, refresh_tokens
from app.services.authz import Principal
from app.services.staff import Staff, staff_of

SessionDep = Annotated[AsyncSession, Depends(get_session)]


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_limiter(request: Request) -> RateLimiter:
    return request.app.state.limiter


def get_mailer(request: Request) -> Mailer:
    return request.app.state.mailer


def get_breach_checker(request: Request) -> BreachChecker:
    return request.app.state.breaches


def get_hub(request: Request) -> Hub:
    return request.app.state.hub


class Pusher:
    """Queues a push to a user's devices; it runs after the response is sent."""

    def __init__(self, request: Request, tasks: BackgroundTasks) -> None:
        self._sessionmaker = request.app.state.sessionmaker
        self._sender = request.app.state.push
        self._mailer = request.app.state.mailer
        self._tasks = tasks
        self.web_url: str = request.app.state.settings.web_url

    def to_user(self, user_id: uuid.UUID, message: PushMessage) -> None:
        self._tasks.add_task(notify_user, self._sessionmaker, self._sender, user_id, message)

    def to_user_or_email(
        self, user_id: uuid.UUID, message: PushMessage, email: Callable[[User], Email]
    ) -> None:
        """Push, or email students who don't use the app (see push.notify_or_email)."""
        self._tasks.add_task(
            notify_or_email,
            self._sessionmaker,
            self._sender,
            self._mailer,
            user_id,
            message,
            email,
        )


class Outbox:
    """Sends alerts a request just queued (services/outbox.py) after the response, instead of
    waiting for the next sweep; the sweep is the fallback if this fails."""

    def __init__(self, request: Request, tasks: BackgroundTasks) -> None:
        self._sessionmaker = request.app.state.sessionmaker
        self._sender = request.app.state.push
        self._mailer = request.app.state.mailer
        self._tasks = tasks
        self.web_url: str = request.app.state.settings.web_url

    def send_now(self, ids: list[int]) -> None:
        if ids:
            self._tasks.add_task(
                outbox.deliver, self._sessionmaker, self._sender, self._mailer, ids
            )


SettingsDep = Annotated[Settings, Depends(get_settings)]
LimiterDep = Annotated[RateLimiter, Depends(get_limiter)]
HubDep = Annotated[Hub, Depends(get_hub)]
MailerDep = Annotated[Mailer, Depends(get_mailer)]
BreachesDep = Annotated[BreachChecker, Depends(get_breach_checker)]
PushDep = Annotated[Pusher, Depends(Pusher)]
OutboxDep = Annotated[Outbox, Depends(Outbox)]


CLIENT_IP_HEADER = "X-Client-IP"
INTERNAL_AUTH_HEADER = "X-Internal-Auth"


def _ip(value: str | None) -> str | None:
    try:
        return str(ipaddress.ip_address((value or "").strip()))
    except ValueError:
        return None


def client_ip(request: Request) -> str:
    """The caller's IP for per-IP rate limits, from sources a client cannot forge:

    1. The web server's X-Client-IP, only when it carries the shared INTERNAL_API_SECRET.
    2. The entry our own proxy (PROXY_HOPS deep) appended to X-Forwarded-For. Entries to its
       left came from the client and are ignored.
    3. The TCP peer.
    """
    settings = request.app.state.settings
    secret = settings.internal_api_secret
    if secret is not None:
        sent = request.headers.get(INTERNAL_AUTH_HEADER, "")
        if hmac.compare_digest(sent.encode(), secret.get_secret_value().encode()):
            if ip := _ip(request.headers.get(CLIENT_IP_HEADER)):
                return ip
    if settings.proxy_hops:
        hops = [h for h in request.headers.get("x-forwarded-for", "").split(",") if h.strip()]
        if len(hops) >= settings.proxy_hops and (ip := _ip(hops[-settings.proxy_hops])):
            return ip
    return request.client.host if request.client else "unknown"


def too_many(e: RateLimited) -> HTTPException:
    return HTTPException(
        status.HTTP_429_TOO_MANY_REQUESTS,
        detail="Too many attempts. Try again later.",
        headers={"Retry-After": str(e.retry_after)},
    )


async def enforce(limiter: RateLimiter, scope: str, key: str, limit: Limit) -> None:
    try:
        await limiter.hit(scope, key, limit)
    except RateLimited as e:
        raise too_many(e) from None


UNAUTHORIZED = HTTPException(
    status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)

_bearer = HTTPBearer(auto_error=False)


async def get_optional_user(
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User | None:
    """None when no bearer token is sent; 401 when one is sent but invalid (never silently
    downgrade a bad token to anonymous)."""
    if credentials is None:
        return None
    try:
        claims = decode_access_token(
            credentials.credentials, settings.jwt_secret.get_secret_value()
        )
    except InvalidToken:
        raise UNAUTHORIZED from None
    user = await session.get(User, claims.user_id)
    if user is None or not user.active:  # deleted or turned off after the token was issued
        raise UNAUTHORIZED  # the app refreshes, fails, and signs out to the sign-in page
    if claims.session_id is not None and not await refresh_tokens.is_live(
        session, user.id, claims.session_id
    ):
        raise UNAUTHORIZED  # that device was signed out, or the password was reset
    request.state.session_id = claims.session_id
    if not user.email_verified:  # login already refuses these; defense in depth
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Email not verified")
    if role := request.headers.get(VIEW_AS_HEADER, "").strip():
        await _view_as(request, session, user, role)
    return user


# ---------- a developer viewing the app as a role (read-only) ----------

VIEW_AS_HEADER = "X-View-As-Role"
# The roles a developer can view the screens of. Their own role ("developer") is not one: not
# viewing is the developer view.
VIEWABLE_ROLES = frozenset(
    {UserRole.ADMIN, UserRole.HEAD_WARDEN, UserRole.WARDEN, UserRole.STUDENT}
)
READ_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
UNKNOWN_ROLE = "Unknown role to view as"
DEVELOPERS_ONLY = "View as is for developers only"
READ_ONLY = "Read-only while viewing as another role"


def read_only() -> HTTPException:
    return HTTPException(status.HTTP_403_FORBIDDEN, detail=READ_ONLY)


def viewing_as_of(request: Request) -> UserRole | None:
    """The role a developer is viewing the screens of in this request, else None."""
    return getattr(request.state, "viewing_as", None)


async def _view_as(request: Request, session: AsyncSession, user: User, raw: str) -> None:
    """X-View-As-Role: the request still runs as the developer (same account, same access and
    data scope); only GET /auth/me reports the viewed role. WebSockets authenticate on their
    own (api/ws.py) and never see this header.

    Read-only is enforced twice. Any method but GET/HEAD/OPTIONS is refused here. And this
    request's database session can no longer write: ORM writes are refused with the same 403,
    and every later transaction is READ ONLY in Postgres, so a GET with a side effect nobody
    noticed fails instead of writing."""
    try:
        role = UserRole(raw)
    except ValueError:
        role = None
    if role not in VIEWABLE_ROLES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=UNKNOWN_ROLE)
    if user.role != UserRole.DEVELOPER:  # `user` was just read from the database
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail=DEVELOPERS_ONLY)
    if request.method not in READ_METHODS:
        raise read_only()
    request.state.viewing_as = role
    await session.commit()  # nothing pending: ends the transaction so the next one is READ ONLY
    _refuse_writes(session)


def _refuse_writes(session: AsyncSession) -> None:
    sync = session.sync_session

    @event.listens_for(sync, "after_begin")
    def _read_only_transaction(_session, _transaction, connection) -> None:
        connection.exec_driver_sql("SET TRANSACTION READ ONLY")

    @event.listens_for(sync, "before_flush")
    def _no_flush(s, _context, _instances) -> None:
        if s.new or s.deleted or any(s.is_modified(o) for o in s.dirty):
            raise read_only()

    @event.listens_for(sync, "do_orm_execute")
    def _no_dml(state) -> None:
        if state.is_insert or state.is_update or state.is_delete:
            raise read_only()


OptionalUser = Annotated[User | None, Depends(get_optional_user)]


async def get_viewing_as(request: Request, _: OptionalUser) -> UserRole | None:
    """The role a developer is viewing as, else None (after authentication ran)."""
    return viewing_as_of(request)


ViewingAsDep = Annotated[UserRole | None, Depends(get_viewing_as)]


async def not_viewing_as(viewing_as: ViewingAsDep) -> None:
    """For reads kept out of a view as session: the personal data export (a file to save, not
    a screen), a live location (a read that is logged on someone's share)."""
    if viewing_as is not None:
        raise read_only()


async def get_current_user(user: OptionalUser) -> User:
    if user is None:
        raise UNAUTHORIZED
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def get_admin_user(user: CurrentUser) -> User:
    """Campus-wide setup (admins and developers). Students and wardens get 403 (the endpoint
    exists; they just may not use it)."""
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Admins only")
    return user


AdminUser = Annotated[User, Depends(get_admin_user)]


async def get_staff(user: CurrentUser, session: SessionDep) -> Staff:
    """Admins and wardens; a warden's reads and actions cover only their own hostels."""
    staff = await staff_of(session, user)
    if staff is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Hostel office only")
    return staff


StaffUser = Annotated[Staff, Depends(get_staff)]


async def get_rules_editor(user: CurrentUser) -> User:
    """Outing rules, holidays and which rules each hostel follows: admins (and developers) and
    head wardens."""
    if not (user.is_admin or user.role == UserRole.HEAD_WARDEN):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Admins and head wardens only")
    return user


RulesUser = Annotated[User, Depends(get_rules_editor)]

GUEST_TOKEN_HEADER = "X-Guest-Token"  # noqa: S105 - header name, not a secret


async def get_principal(
    user: OptionalUser,
    guest_token: Annotated[str | None, Header(alias=GUEST_TOKEN_HEADER, max_length=200)] = None,
) -> Principal:
    """A logged-in user, or a guest identified by the token issued when they redeemed a code.
    Guest tokens travel in a header, never in the URL (URLs end up in logs and history)."""
    if user is not None:
        return Principal(user_id=user.id)
    if guest_token:
        return Principal(guest_token_hash=hash_guest_token(guest_token))
    raise UNAUTHORIZED


PrincipalDep = Annotated[Principal, Depends(get_principal)]
