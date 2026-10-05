"""Authentication: register, verify email, login, refresh, logout, me."""

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import (
    CurrentUser,
    LimiterDep,
    MailerDep,
    SessionDep,
    SettingsDep,
    client_ip,
    enforce,
    too_many,
)
from app.models import User
from app.schemas import (
    EmailIn,
    LoginIn,
    RefreshIn,
    RegisterIn,
    TokenOut,
    UserOut,
    VerifyEmailIn,
)
from app.security.passwords import hash_password, needs_rehash, verify_password
from app.security.rate_limit import Limit, RateLimited
from app.security.tokens import ACCESS_TTL, InvalidToken, create_access_token
from app.services import refresh_tokens, verification

router = APIRouter(prefix="/auth", tags=["auth"])

REGISTER_PER_IP = Limit(max_hits=5, window_seconds=3600)
LOGIN_PER_IP = Limit(max_hits=20, window_seconds=900)
LOGIN_FAILURES_PER_EMAIL = Limit(max_hits=5, window_seconds=900)
REFRESH_PER_IP = Limit(max_hits=30, window_seconds=60)
VERIFY_FAILURES_PER_IP = Limit(max_hits=20, window_seconds=3600)
RESEND_PER_EMAIL = Limit(max_hits=3, window_seconds=900)
RESEND_PER_IP = Limit(max_hits=10, window_seconds=3600)

INVALID_LOGIN = HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
INVALID_REFRESH = HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
NOT_VERIFIED = HTTPException(status.HTTP_403_FORBIDDEN, detail="Email not verified")
INVALID_CODE = HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invalid or expired code")


def _token_pair(settings: SettingsDep, user: User, refresh: str) -> TokenOut:
    return TokenOut(
        access_token=create_access_token(user.id, settings.jwt_secret.get_secret_value()),
        expires_in=int(ACCESS_TTL.total_seconds()),
        refresh_token=refresh,
    )


def _domain_error(settings: SettingsDep) -> HTTPException:
    domains = ", ".join(f"@{d}" for d in settings.allowed_email_domains)
    return HTTPException(
        status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Use your university email ({domains})"
    )


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterIn,
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
    limiter: LimiterDep,
    mailer: MailerDep,
) -> UserOut:
    if not verification.email_allowed(body.email, settings):
        raise _domain_error(settings)
    enforce(limiter, "register:ip", client_ip(request), REGISTER_PER_IP)
    user = User(
        name=body.name,
        email=body.email,
        password_hash=hash_password(body.password),
        roll_no=body.roll_no,
        hostel=body.hostel,
    )
    session.add(user)
    try:
        await session.commit()
    except IntegrityError:
        # Registration necessarily reveals that an email exists; the per-IP limit above
        # keeps that from being usable as a bulk lookup.
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Email already registered") from None
    await session.refresh(user)
    await verification.issue(session, user, settings.code_pepper.get_secret_value(), mailer)
    return UserOut.model_validate(user)


@router.post("/verify-email")
async def verify_email(
    body: VerifyEmailIn,
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
    limiter: LimiterDep,
) -> UserOut:
    """Proves the student controls the inbox. Each code allows 5 tries, then must be resent."""
    ip = client_ip(request)
    try:
        limiter.check("verify:ip", ip, VERIFY_FAILURES_PER_IP)
    except RateLimited as e:
        raise too_many(e) from None
    try:
        user = await verification.verify(
            session, body.email, body.code, settings.code_pepper.get_secret_value()
        )
    except verification.VerificationFailed:
        limiter.hit("verify:ip", ip, VERIFY_FAILURES_PER_IP)
        raise INVALID_CODE from None
    return UserOut.model_validate(user)


@router.post("/resend-verification", status_code=status.HTTP_202_ACCEPTED)
async def resend_verification(
    body: EmailIn,
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
    limiter: LimiterDep,
    mailer: MailerDep,
) -> Response:
    """Always 202: the response never says whether the account exists or is verified."""
    email = body.email.lower()
    enforce(limiter, "resend:ip", client_ip(request), RESEND_PER_IP)
    enforce(limiter, "resend:email", email, RESEND_PER_EMAIL)
    user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is not None and not user.email_verified:
        await verification.issue(session, user, settings.code_pepper.get_secret_value(), mailer)
    return Response(status_code=status.HTTP_202_ACCEPTED)


@router.post("/login")
async def login(
    body: LoginIn,
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
    limiter: LimiterDep,
) -> TokenOut:
    email = body.email.lower()
    enforce(limiter, "login:ip", client_ip(request), LOGIN_PER_IP)
    try:
        # Checked before verifying, so a locked email stays locked even with the right password.
        limiter.check("login:email", email, LOGIN_FAILURES_PER_EMAIL)
    except RateLimited as e:
        raise too_many(e) from None

    user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if not verify_password(user.password_hash if user else None, body.password):
        limiter.hit("login:email", email, LOGIN_FAILURES_PER_EMAIL)
        raise INVALID_LOGIN
    assert user is not None

    limiter.reset("login:email", email)
    if not user.email_verified:
        raise NOT_VERIFIED  # only revealed after the correct password
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
    refresh = await refresh_tokens.issue(session, user.id)
    await session.commit()
    return _token_pair(settings, user, refresh)


@router.post("/refresh")
async def refresh(
    body: RefreshIn,
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
    limiter: LimiterDep,
) -> TokenOut:
    enforce(limiter, "refresh:ip", client_ip(request), REFRESH_PER_IP)
    try:
        user_id, successor = await refresh_tokens.rotate(session, body.refresh_token)
    except InvalidToken:
        raise INVALID_REFRESH from None
    user = await session.get(User, user_id)
    if user is None:
        raise INVALID_REFRESH
    return _token_pair(settings, user, successor)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(body: RefreshIn, session: SessionDep) -> Response:
    await refresh_tokens.revoke_by_token(session, body.refresh_token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me")
async def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)
