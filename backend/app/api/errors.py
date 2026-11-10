"""POST /errors: the website and the app report what broke. GET /errors: the developer's list.

Anyone may report (a crash on the sign-in page matters too), so the endpoint is careful:
- a browser must be on Lumiback's own pages (its Origin), and the body must be JSON;
- the body is capped before it is read (Content-Length, then while streaming), and so is every
  field (schemas.ErrorReportIn); control and invisible characters are stripped;
- rate limits per IP and, when signed in, per account (one hit on both, or none);
- a bearer token only names the reporter when it is valid now; a bad, stale or revoked one is
  not refused (the report still matters), it just names nobody;
- everything is scrubbed before it is stored (services/error_reports.py).
"""

import json
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError

from app.api.deps import CurrentUser, LimiterDep, SessionDep, SettingsDep, client_ip, too_many
from app.models import User, UserRole
from app.schemas import ErrorGroupList, ErrorReportIn
from app.security.rate_limit import Limit, RateLimited
from app.security.tokens import InvalidToken, decode_access_token
from app.services import error_reports, refresh_tokens

router = APIRouter(prefix="/errors", tags=["errors"])

MAX_BODY_BYTES = 16 * 1024
# Generous per IP: a campus network puts many students behind one address. The clients send
# each error once per page load or app run, and at most a few.
PER_IP = Limit(max_hits=120, window_seconds=3600)
PER_USER = Limit(max_hits=30, window_seconds=3600)
DEVELOPERS = "Developers only"
TOO_LARGE = HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, detail="Report too large")


async def _body(request: Request) -> bytes:
    declared = request.headers.get("content-length")
    if declared is not None:
        if not declared.isdigit():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Bad Content-Length")
        if int(declared) > MAX_BODY_BYTES:
            raise TOO_LARGE
    size, chunks = 0, []
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_BODY_BYTES:
            raise TOO_LARGE
        chunks.append(chunk)
    return b"".join(chunks)


def _parse(raw: bytes) -> ErrorReportIn:
    try:
        data = json.loads(raw)
    except (ValueError, RecursionError):
        raise RequestValidationError(
            [{"type": "json_invalid", "loc": ("body",), "msg": "Not valid JSON"}]
        ) from None
    try:
        return ErrorReportIn.model_validate(data)
    except ValidationError as e:
        raise RequestValidationError(e.errors(include_input=False, include_url=False)) from None


async def _reporter(request: Request, session: SessionDep, settings: SettingsDep) -> User | None:
    """The signed-in account, only when the token is valid now; otherwise nobody."""
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    try:
        claims = decode_access_token(token.strip(), settings.jwt_secret.get_secret_value())
    except InvalidToken:
        return None
    user = await refresh_tokens.signed_in_user(session, claims.user_id, claims.session_id)
    if user is None or not user.active or not user.email_verified:
        return None
    return user


def _check_sender(request: Request, settings: SettingsDep) -> None:
    """A browser may only report from Lumiback's own pages. CORS stops another site reading the
    answer, not sending: a page anywhere could post made-up reports from its visitors'
    browsers (with their IPs). So an Origin header, when there is one, must be one of ours,
    as for the WebSocket (api/ws.py). The app and the web server send none, like any native
    client. And only JSON: a form or text/plain post is what another page can send without
    asking the browser first (a CORS preflight)."""
    origin = request.headers.get("origin")
    if origin is not None and origin.rstrip("/") not in settings.cors_origins:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Not from Lumiback")
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type != "application/json":
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Send JSON")


@router.post("", status_code=status.HTTP_204_NO_CONTENT)
async def report_error(
    request: Request, session: SessionDep, settings: SettingsDep, limiter: LimiterDep
) -> Response:
    _check_sender(request, settings)
    report = _parse(await _body(request))
    user = await _reporter(request, session, settings)
    hits = [("errors:ip", client_ip(request), PER_IP)]
    if user is not None:
        hits.append(("errors:user", str(user.id), PER_USER))
    try:
        await limiter.hit_all(hits)
    except RateLimited as e:
        raise too_many(e) from None
    await error_reports.record(session, report, user)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("")
async def list_errors(
    user: CurrentUser,
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> ErrorGroupList:
    """The most recently seen groups. Real developers only: the role is the account's own, so
    a developer viewing as another role still reads it (a GET), like /meta/status."""
    if user.role != UserRole.DEVELOPER:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail=DEVELOPERS)
    return ErrorGroupList(items=await error_reports.recent(session, limit))
