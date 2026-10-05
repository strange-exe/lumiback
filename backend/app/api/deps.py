"""Shared request dependencies: DB session, settings, rate limiting, current user."""

from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db import get_session
from app.models import User
from app.security.rate_limit import Limit, RateLimited, RateLimiter
from app.security.tokens import InvalidToken, decode_access_token

SessionDep = Annotated[AsyncSession, Depends(get_session)]


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_limiter(request: Request) -> RateLimiter:
    return request.app.state.limiter


SettingsDep = Annotated[Settings, Depends(get_settings)]
LimiterDep = Annotated[RateLimiter, Depends(get_limiter)]


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


def enforce(limiter: RateLimiter, scope: str, key: str, limit: Limit) -> None:
    try:
        limiter.hit(scope, key, limit)
    except RateLimited as e:
        raise too_many(e) from None


UNAUTHORIZED = HTTPException(
    status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)

_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    session: SessionDep,
    settings: SettingsDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
    if credentials is None:
        raise UNAUTHORIZED
    try:
        claims = decode_access_token(
            credentials.credentials, settings.jwt_secret.get_secret_value()
        )
    except InvalidToken:
        raise UNAUTHORIZED from None
    user = await session.get(User, claims.user_id)
    if user is None:  # account deleted after the token was issued
        raise UNAUTHORIZED
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
