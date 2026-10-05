"""Shared request dependencies: DB session, settings, rate limiting, current user."""

from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db import get_session
from app.email import Mailer
from app.models import User
from app.realtime import Hub
from app.security.codes import hash_guest_token
from app.security.rate_limit import Limit, RateLimited, RateLimiter
from app.security.tokens import InvalidToken, decode_access_token
from app.services.authz import Principal

SessionDep = Annotated[AsyncSession, Depends(get_session)]


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_limiter(request: Request) -> RateLimiter:
    return request.app.state.limiter


def get_mailer(request: Request) -> Mailer:
    return request.app.state.mailer


def get_hub(request: Request) -> Hub:
    return request.app.state.hub


SettingsDep = Annotated[Settings, Depends(get_settings)]
LimiterDep = Annotated[RateLimiter, Depends(get_limiter)]
HubDep = Annotated[Hub, Depends(get_hub)]
MailerDep = Annotated[Mailer, Depends(get_mailer)]


def client_ip(request: Request) -> str:
    # Behind a reverse proxy, run uvicorn with --proxy-headers and a strict --forwarded-allow-ips
    # so this is the real client address, not the proxy's.
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
    if user is None:  # account deleted after the token was issued
        raise UNAUTHORIZED
    if not user.email_verified:  # login already refuses these; defense in depth
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Email not verified")
    return user


OptionalUser = Annotated[User | None, Depends(get_optional_user)]


async def get_current_user(user: OptionalUser) -> User:
    if user is None:
        raise UNAUTHORIZED
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]

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
