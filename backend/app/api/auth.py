"""Authentication: register, verify email, login, refresh, logout, me, delete account."""

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import or_, select

from app.api.deps import (
    CurrentUser,
    HubDep,
    LimiterDep,
    MailerDep,
    SessionDep,
    SettingsDep,
    client_ip,
    enforce,
    too_many,
)
from app.models import SessionStatus, ShareSession, ShareViewer, User
from app.realtime import AccessChanged
from app.schemas import (
    DeleteAccountIn,
    EmailIn,
    LoginIn,
    RefreshIn,
    RegisteredOut,
    RegisterIn,
    ResetPasswordIn,
    TokenOut,
    UserOut,
    VerifyEmailIn,
)
from app.security.passwords import hash_password, needs_rehash, verify_password
from app.security.rate_limit import Limit, RateLimited
from app.security.tokens import ACCESS_TTL, InvalidToken, create_access_token
from app.services import password_reset, refresh_tokens, verification

router = APIRouter(prefix="/auth", tags=["auth"])

REGISTER_PER_IP = Limit(max_hits=5, window_seconds=3600)
LOGIN_PER_IP = Limit(max_hits=20, window_seconds=900)
LOGIN_FAILURES_PER_EMAIL = Limit(max_hits=5, window_seconds=900)
REFRESH_PER_IP = Limit(max_hits=30, window_seconds=60)
VERIFY_FAILURES_PER_IP = Limit(max_hits=20, window_seconds=3600)
RESEND_PER_EMAIL = Limit(max_hits=3, window_seconds=900)
RESEND_PER_IP = Limit(max_hits=10, window_seconds=3600)
DELETE_FAILURES_PER_USER = Limit(max_hits=5, window_seconds=3600)
FORGOT_PER_EMAIL = Limit(max_hits=3, window_seconds=900)
FORGOT_PER_IP = Limit(max_hits=10, window_seconds=3600)
RESET_FAILURES_PER_IP = Limit(max_hits=20, window_seconds=3600)

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


EMAIL_NOT_SENT = HTTPException(
    status.HTTP_503_SERVICE_UNAVAILABLE,
    detail="We couldn't send the email just now. Please try again in a minute.",
)


@router.post("/register", status_code=status.HTTP_202_ACCEPTED)
async def register(
    body: RegisterIn,
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
    limiter: LimiterDep,
    mailer: MailerDep,
) -> RegisteredOut:
    """Starts a sign-up and emails a code. The account is created only when the code is entered
    (POST /auth/verify-email); until then nothing about this person is kept beyond 15 minutes."""
    if not verification.email_allowed(body.email, settings):
        raise _domain_error(settings)
    await enforce(limiter, "register:ip", client_ip(request), REGISTER_PER_IP)
    try:
        await verification.start(session, body, settings.code_pepper.get_secret_value(), mailer)
    except verification.AlreadyRegistered:
        # Registration necessarily reveals that an email exists; the per-IP limit above
        # keeps that from being usable as a bulk lookup.
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Email already registered") from None
    except verification.EmailNotSent:
        raise EMAIL_NOT_SENT from None
    minutes = int(verification.CODE_TTL.total_seconds() // 60)
    return RegisteredOut(email=body.email, code_expires_in_minutes=minutes)


@router.post("/verify-email")
async def verify_email(
    body: VerifyEmailIn,
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
    limiter: LimiterDep,
) -> UserOut:
    """Proves the student controls the inbox and creates the account. Each code allows 5 tries,
    then a new one must be requested. Only a correct code ever returns account details."""
    ip = client_ip(request)
    try:
        await limiter.check("verify:ip", ip, VERIFY_FAILURES_PER_IP)
    except RateLimited as e:
        raise too_many(e) from None
    try:
        user = await verification.verify(
            session, body.email, body.code, settings.code_pepper.get_secret_value()
        )
    except verification.VerificationFailed:
        await limiter.record("verify:ip", ip)
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
    """202 whether or not a sign-up is pending: the response never says which emails exist."""
    email = body.email.lower()
    await enforce(limiter, "resend:ip", client_ip(request), RESEND_PER_IP)
    await enforce(limiter, "resend:email", email, RESEND_PER_EMAIL)
    try:
        await verification.resend(session, email, settings.code_pepper.get_secret_value(), mailer)
    except verification.EmailNotSent:
        raise EMAIL_NOT_SENT from None
    return Response(status_code=status.HTTP_202_ACCEPTED)


@router.post("/forgot-password", status_code=status.HTTP_202_ACCEPTED)
async def forgot_password(
    body: EmailIn,
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
    limiter: LimiterDep,
    mailer: MailerDep,
) -> Response:
    """Emails a reset code if a verified account uses this address. Always 202: the response
    never says which emails have accounts."""
    email = body.email.lower()
    await enforce(limiter, "forgot:ip", client_ip(request), FORGOT_PER_IP)
    await enforce(limiter, "forgot:email", email, FORGOT_PER_EMAIL)
    try:
        await password_reset.start(session, email, settings.code_pepper.get_secret_value(), mailer)
    except password_reset.EmailNotSent:
        raise EMAIL_NOT_SENT from None
    return Response(status_code=status.HTTP_202_ACCEPTED)


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(
    body: ResetPasswordIn,
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
    limiter: LimiterDep,
) -> Response:
    """Sets a new password with the emailed code and signs out every device. The app then signs
    in with the new password. Each code allows 5 tries."""
    ip = client_ip(request)
    try:
        await limiter.check("reset:ip", ip, RESET_FAILURES_PER_IP)
    except RateLimited as e:
        raise too_many(e) from None
    try:
        await password_reset.finish(
            session, body.email, body.code, body.password, settings.code_pepper.get_secret_value()
        )
    except password_reset.ResetFailed:
        await limiter.record("reset:ip", ip)
        raise INVALID_CODE from None
    except password_reset.WeakPassword as e:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Password {e.problem}"
        ) from None
    # A locked-out login (too many wrong passwords) shouldn't outlive the reset that fixes it.
    await limiter.reset("login:email", body.email.lower())
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/login")
async def login(
    body: LoginIn,
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
    limiter: LimiterDep,
) -> TokenOut:
    email = body.email.lower()
    await enforce(limiter, "login:ip", client_ip(request), LOGIN_PER_IP)
    try:
        # Checked before verifying, so a locked email stays locked even with the right password.
        await limiter.check("login:email", email, LOGIN_FAILURES_PER_EMAIL)
    except RateLimited as e:
        raise too_many(e) from None

    user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if not verify_password(user.password_hash if user else None, body.password):
        await limiter.record("login:email", email)
        raise INVALID_LOGIN
    assert user is not None

    await limiter.reset("login:email", email)
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
    await enforce(limiter, "refresh:ip", client_ip(request), REFRESH_PER_IP)
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


@router.post("/delete-account", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    body: DeleteAccountIn,
    user: CurrentUser,
    session: SessionDep,
    limiter: LimiterDep,
    hub: HubDep,
) -> Response:
    """Permanently delete the account and everything tied to it (every foreign key cascades):
    outings, shares and their locations, viewers, contacts, codes, tokens, the access log."""
    try:
        await limiter.check("delete:user", str(user.id), DELETE_FAILURES_PER_USER)
    except RateLimited as e:
        raise too_many(e) from None
    if not verify_password(user.password_hash, body.password):
        await limiter.record("delete:user", str(user.id))
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="That password isn't right")

    # Live shares this account is part of: as the sharer, or watching someone else's.
    affected = list(
        (
            await session.execute(
                select(ShareSession.id)
                .outerjoin(ShareViewer, ShareViewer.session_id == ShareSession.id)
                .where(
                    ShareSession.status == SessionStatus.ACTIVE,
                    or_(ShareSession.sharer_id == user.id, ShareViewer.viewer_user_id == user.id),
                )
                .distinct()
            )
        ).scalars()
    )
    await session.delete(user)
    await session.commit()
    for session_id in affected:  # after commit: open streams re-check and end
        await hub.publish(AccessChanged(session_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
