"""Redeeming join codes (logged-in users or guests).

Brute force: codes carry ~50 bits and live 10 minutes. Failed redeems are limited per IP and
per account, so an attacker gets ~30 guesses/hour/IP against a 2^50 space. There is deliberately
no global limit: it would let one attacker lock every legitimate user out.
"""

from fastapi import APIRouter, HTTPException, Request, status

from app.api.deps import LimiterDep, OptionalUser, SessionDep, SettingsDep, client_ip, too_many
from app.schemas import RedeemIn, RedeemOut
from app.security.rate_limit import Limit, RateLimited
from app.services import codes as svc

router = APIRouter(prefix="/codes", tags=["codes"])

FAILURES_PER_IP = Limit(max_hits=5, window_seconds=600)
FAILURES_PER_USER = Limit(max_hits=5, window_seconds=600)
INVALID = HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invalid or expired code")


@router.post("/redeem")
async def redeem(
    body: RedeemIn,
    request: Request,
    user: OptionalUser,
    session: SessionDep,
    settings: SettingsDep,
    limiter: LimiterDep,
) -> RedeemOut:
    if user is None and body.guest_label is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, detail="guest_label is required for guests"
        )
    keys = [("redeem:ip", client_ip(request), FAILURES_PER_IP)]
    if user is not None:
        keys.append(("redeem:user", str(user.id), FAILURES_PER_USER))
    try:
        # Checked before trying, so a locked-out client cannot test even a correct code.
        for scope, key, limit in keys:
            limiter.check(scope, key, limit)
    except RateLimited as e:
        raise too_many(e) from None

    try:
        result = await svc.redeem(
            session,
            body.code,
            settings.code_pepper.get_secret_value(),
            user_id=user.id if user else None,
            guest_label=None if user else body.guest_label,
        )
    except svc.InvalidCode:
        for scope, key, limit in keys:
            limiter.hit(scope, key, limit)
        raise INVALID from None
    except svc.OwnSession:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, detail="You cannot join your own session"
        ) from None

    return RedeemOut(
        session_id=result.session_id,
        viewer_id=result.viewer_id,
        status=result.status.value,
        guest_token=result.guest_token,
    )
