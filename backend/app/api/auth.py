"""Authentication: register, verify email, login, refresh, logout, me, delete account."""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import or_, select

from app.api.deps import (
    UNAUTHORIZED,
    BreachesDep,
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
from app.models import LinkPurpose, SessionStatus, ShareSession, ShareViewer, User
from app.realtime import AccessChanged
from app.schemas import (
    ChangePasswordIn,
    DeleteAccountIn,
    DeviceOut,
    EmailIn,
    LinkInfoOut,
    LinkTokenIn,
    LoginIn,
    RefreshIn,
    RegisteredOut,
    RegisterIn,
    ResetPasswordIn,
    SetPasswordIn,
    SetPasswordOut,
    TokenOut,
    UserOut,
    VerifyEmailIn,
)
from app.security.breached import BREACHED
from app.security.passwords import hash_password_async, needs_rehash, verify_password_async
from app.security.rate_limit import Limit, RateLimited
from app.security.tokens import ACCESS_TTL, InvalidToken, create_access_token
from app.services import (
    account_links,
    accounts,
    device_label,
    password_reset,
    refresh_tokens,
    verification,
)

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
LINK_FAILURES_PER_IP = Limit(max_hits=20, window_seconds=3600)
DEVICE_SIGN_OUTS = Limit(max_hits=30, window_seconds=3600)
# Wrong current passwords: a stolen session can't guess its way to a new password.
CHANGE_FAILURES_PER_USER = Limit(max_hits=5, window_seconds=3600)
CHANGE_TRIES_PER_USER = Limit(max_hits=10, window_seconds=3600)  # right or wrong

INVALID_LOGIN = HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
INVALID_REFRESH = HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
NOT_VERIFIED = HTTPException(status.HTTP_403_FORBIDDEN, detail="Email not verified")
TURNED_OFF = HTTPException(
    status.HTTP_403_FORBIDDEN,
    detail="This account has been turned off. Ask your hostel office to turn it back on.",
)
INVALID_CODE = HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invalid or expired code")
LINK_FAILED = HTTPException(
    status.HTTP_404_NOT_FOUND,
    detail="This link has expired or was already used. Use Forgot password to get a new one.",
)


def _token_pair(settings: SettingsDep, user: User, refresh: str, family_id: uuid.UUID) -> TokenOut:
    return TokenOut(
        access_token=create_access_token(
            user.id, settings.jwt_secret.get_secret_value(), session_id=family_id
        ),
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
    breaches: BreachesDep,
) -> RegisteredOut:
    """Starts a sign-up and emails a code. The account is created only when the code is entered
    (POST /auth/verify-email); until then nothing about this person is kept beyond 15 minutes."""
    if not verification.email_allowed(body.email, settings):
        raise _domain_error(settings)
    await enforce(limiter, "register:ip", client_ip(request), REGISTER_PER_IP)
    # After the rate limit, so the endpoint can't be used to run lookups in bulk.
    if await breaches.is_breached(body.password):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Password {BREACHED}")
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
    pepper = settings.code_pepper.get_secret_value()
    # An imported student who lost (or let expire) their set-up email gets a fresh one: they
    # have no password a code could replace, and the link proves the inbox is theirs.
    imported = await session.scalar(
        select(User).where(
            User.email == email,
            User.email_verified_at.is_(None),
            User.deactivated_at.is_(None),  # turned off: nothing is sent, same 202
        )
    )
    try:
        if imported is not None:
            uid, name = imported.id, imported.name
            token = await account_links.issue(
                session, uid, LinkPurpose.INVITE, pepper, created_by=None
            )
            await session.commit()
            await account_links.send(
                session,
                mailer,
                user_id=uid,
                to=email,
                name=name,
                purpose=LinkPurpose.INVITE,
                token=token,
                web_url=settings.web_url,
                pepper=pepper,
            )
        else:
            await password_reset.start(session, email, pepper, mailer)
    except (password_reset.EmailNotSent, account_links.EmailNotSent):
        raise EMAIL_NOT_SENT from None
    return Response(status_code=status.HTTP_202_ACCEPTED)


@router.post("/password-link")
async def password_link_info(
    body: LinkTokenIn,
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
    limiter: LimiterDep,
) -> LinkInfoOut:
    """Whose set-password link this is, so the page can greet them (404 if it doesn't work).
    A POST, so the token never lands in an access log."""
    ip = client_ip(request)
    try:
        await limiter.check("link:ip", ip, LINK_FAILURES_PER_IP)
    except RateLimited as e:
        raise too_many(e) from None
    pepper = settings.code_pepper.get_secret_value()
    try:
        user = await account_links.peek(session, body.token, pepper)
    except account_links.LinkFailed:
        await limiter.record("link:ip", ip)
        raise LINK_FAILED from None
    return LinkInfoOut(name=user.name, email=user.email, invite=user.email_verified_at is None)


@router.post("/set-password")
async def set_password(
    body: SetPasswordIn,
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
    limiter: LimiterDep,
    breaches: BreachesDep,
) -> SetPasswordOut:
    """Chooses a password with a link an admin sent (imported student or admin reset). The
    link then stops working, the email counts as verified, and every device is signed out."""
    ip = client_ip(request)
    try:
        await limiter.check("link:ip", ip, LINK_FAILURES_PER_IP)
    except RateLimited as e:
        raise too_many(e) from None
    try:
        user = await account_links.finish(
            session, body.token, body.password, settings.code_pepper.get_secret_value(), breaches
        )
    except account_links.LinkFailed:
        await limiter.record("link:ip", ip)
        raise LINK_FAILED from None
    except account_links.WeakPassword as e:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Password {e.problem}"
        ) from None
    await limiter.reset("login:email", user.email)
    return SetPasswordOut(email=user.email)


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(
    body: ResetPasswordIn,
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
    limiter: LimiterDep,
    breaches: BreachesDep,
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
            session,
            body.email,
            body.code,
            body.password,
            settings.code_pepper.get_secret_value(),
            breaches,
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
    # Every try is counted before verifying, atomically (so a burst can't all pass the check
    # before any is recorded), and a locked email stays locked even with the right password.
    # A right password clears the count below.
    await enforce(limiter, "login:email", email, LOGIN_FAILURES_PER_EMAIL)

    user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if not await verify_password_async(user.password_hash if user else None, body.password):
        raise INVALID_LOGIN
    assert user is not None
    # Like every sign-out (refresh_tokens._lock_user): a reset, password change or turn-off at
    # this moment either waits for this sign-in and then ends it, or finishes first, and then
    # the password checked above is no longer the account's.
    checked = user.password_hash
    locked = await session.scalar(
        select(User)
        .where(User.id == user.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if locked is None or locked.password_hash != checked:
        raise INVALID_LOGIN
    user = locked

    await limiter.reset("login:email", email)
    if not user.active:
        raise TURNED_OFF  # only revealed after the correct password; first, so a turned-off
        # account that was never verified isn't sent to the verify page
    if not user.email_verified:
        raise NOT_VERIFIED  # likewise
    if needs_rehash(user.password_hash):
        user.password_hash = await hash_password_async(body.password)
    family = uuid.uuid4()  # this sign-in: one entry in the signed-in devices list
    device = device_label.label(body.device, body.user_agent or request.headers.get("user-agent"))
    refresh = await refresh_tokens.issue(session, user.id, family_id=family, device=device)
    await session.commit()
    return _token_pair(settings, user, refresh, family)


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
        rotated = await refresh_tokens.rotate(session, body.refresh_token)
    except InvalidToken:
        raise INVALID_REFRESH from None
    user = await session.get(User, rotated.user_id)
    if user is None or not user.active:  # turning off revokes these; defense in depth
        raise INVALID_REFRESH
    return _token_pair(settings, user, rotated.token, rotated.family_id)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(body: RefreshIn, session: SessionDep) -> Response:
    await refresh_tokens.revoke_by_token(session, body.refresh_token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- signed-in devices (a lost phone) ----------


def _current(request: Request) -> uuid.UUID | None:
    return getattr(request.state, "session_id", None)


@router.get("/devices")
async def list_devices(user: CurrentUser, request: Request, session: SessionDep) -> list[DeviceOut]:
    """Where this account is signed in, most recently active first."""
    current = _current(request)
    found = await refresh_tokens.devices(session, user.id)
    await session.commit()
    return [
        DeviceOut(
            id=d.id,
            device=d.device,
            signed_in_at=d.signed_in_at,
            last_active_at=d.last_active_at,
            current=d.id == current,
        )
        for d in found
    ]


@router.delete("/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
async def sign_out_device(
    device_id: uuid.UUID, user: CurrentUser, session: SessionDep, limiter: LimiterDep
) -> Response:
    """Signs that device out at once: its sign-in stops working and it gets no more pushes.
    For a lost phone, also change the password (that signs out everywhere)."""
    await enforce(limiter, "devices:user", str(user.id), DEVICE_SIGN_OUTS)
    if not await refresh_tokens.sign_out_device(session, user.id, device_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No such device")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/devices/sign-out-others")
async def sign_out_other_devices(
    user: CurrentUser, request: Request, session: SessionDep, limiter: LimiterDep
) -> dict[str, int]:
    """Every device except this one. Older apps' tokens (no device id) are all signed out."""
    await enforce(limiter, "devices:user", str(user.id), DEVICE_SIGN_OUTS)
    current = _current(request)
    if current is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Sign out and back in on this device first, then try again.",
        )
    return {"signed_out": await refresh_tokens.sign_out_others(session, user.id, current)}


@router.get("/me")
async def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)


@router.post("/change-password")
async def change_password(
    body: ChangePasswordIn,
    user: CurrentUser,
    request: Request,
    session: SessionDep,
    limiter: LimiterDep,
    breaches: BreachesDep,
) -> dict[str, int | bool]:
    """A new password, knowing the current one. Every other device is signed out; this one
    stays signed in (unless it signed in before devices had ids: then it's signed out too)."""
    current = _current(request)
    await session.commit()  # the sign-in check is done: hold no connection while waiting below
    uid = str(user.id)
    # Every try runs argon2 (slow on purpose), so every try is counted, atomically, before it
    # runs; a wrong current password also counts toward the tighter guessing limit.
    try:
        failure_hit, _ = await limiter.hit_all(
            [
                ("change:user", uid, CHANGE_FAILURES_PER_USER),
                ("change-try:user", uid, CHANGE_TRIES_PER_USER),
            ]
        )
    except RateLimited as e:
        raise too_many(e) from None
    try:
        signed_out = await password_reset.change(
            session, user, body.current_password, body.password, breaches, current
        )
    except password_reset.WrongPassword:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail="Your current password isn't right"
        ) from None
    except password_reset.SignedOut:
        raise UNAUTHORIZED from None
    except password_reset.WeakPassword as e:
        await limiter.undo([failure_hit])  # the current password was right
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Password {e.problem}"
        ) from None
    await limiter.undo([failure_hit])
    await limiter.reset("login:email", user.email.lower())  # an old lockout ends here too
    return {"signed_out": signed_out, "still_signed_in": current is not None}


@router.post("/delete-account", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    body: DeleteAccountIn,
    user: CurrentUser,
    session: SessionDep,
    limiter: LimiterDep,
    hub: HubDep,
) -> Response:
    """Permanently delete the account and the person's data: shares and their locations,
    viewers, contacts, devices, tokens and push tokens, codes, gate scans, the access log.

    The hostel's record stays: the student's outings, with their escalations and corrections
    and the requests they used, are detached from the account and keep the name and roll no.
    (and the hostel) as they were, until the sweep purges them once the campus retention
    period has passed since the deletion (app/services/accounts.py, app/jobs/expiry.py).

    Refused (409) while the student is out or a late escalation is still open, and for the
    last admin who can sign in, like turning an account off."""
    # Every try is counted before verifying, atomically, like login: a burst can't all pass
    # the check before any is recorded. A right password deletes the account, count and all.
    try:
        hits = await limiter.hit_all([("delete:user", str(user.id), DELETE_FAILURES_PER_USER)])
    except RateLimited as e:
        raise too_many(e) from None
    if not await verify_password_async(user.password_hash, body.password):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="That password isn't right")
    if refused := await accounts.deletion_refused(session, user):
        await session.rollback()  # releases the account lock
        await limiter.undo(hits)  # the password was right: not a guess
        raise HTTPException(status.HTTP_409_CONFLICT, detail=refused)

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
    await accounts.detach_records(session, user, datetime.now(UTC))
    await session.delete(user)
    await session.commit()
    for session_id in affected:  # after commit: open streams re-check and end
        await hub.publish(AccessChanged(session_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
