"""Join codes: create, redeem (single use, atomic), and the resulting pending viewer.

Redeeming a code never grants access. It creates a *pending* viewer that the sharer approves on
their own device (two-sided consent, PLAN §3.1).
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import case, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import SessionStatus, ShareCode, ShareSession, ShareViewer, ViewerStatus
from app.security import codes

CODE_TTL = timedelta(minutes=10)


class InvalidCode(Exception):
    """Unknown, used, expired, or for a session that is no longer live."""


class OwnSession(Exception):
    """The sharer tried to join their own session."""


@dataclass(frozen=True)
class Redeemed:
    session_id: uuid.UUID
    viewer_id: uuid.UUID
    status: ViewerStatus
    guest_token: str | None  # returned once, to guests only


async def create(session: AsyncSession, share: ShareSession, pepper: str) -> tuple[str, datetime]:
    """Return (display code, expires_at). The plaintext code is never stored."""
    code = codes.new_code()
    expires_at = datetime.now(UTC) + CODE_TTL
    session.add(
        ShareCode(
            session_id=share.id,
            created_by=share.sharer_id,
            code_hash=codes.hash_code(code, pepper),
            expires_at=expires_at,
        )
    )
    await session.commit()
    return codes.display(code), expires_at


async def redeem(
    session: AsyncSession,
    raw_code: str,
    pepper: str,
    *,
    user_id: uuid.UUID | None,
    guest_label: str | None,
) -> Redeemed:
    code = codes.normalize(raw_code)
    if code is None:
        raise InvalidCode
    now = datetime.now(UTC)

    # Single use: of two concurrent redeems, exactly one matches `used_at IS NULL`.
    claimed = (
        await session.execute(
            update(ShareCode)
            .where(
                ShareCode.code_hash == codes.hash_code(code, pepper),
                ShareCode.used_at.is_(None),
                ShareCode.expires_at > now,
                ShareCode.session_id == ShareSession.id,
                ShareSession.status == SessionStatus.ACTIVE,
                ShareSession.ends_at > now,
            )
            .values(used_at=now)
            .returning(ShareCode.session_id, ShareSession.sharer_id)
        )
    ).first()
    if claimed is None:
        raise InvalidCode
    if claimed.sharer_id == user_id:
        await session.rollback()  # leave the code unused
        raise OwnSession

    guest_token: str | None = None
    if user_id is not None:
        # A revoked viewer may ask again, but only as a new *pending* request.
        viewer = (
            await session.execute(
                insert(ShareViewer)
                .values(session_id=claimed.session_id, viewer_user_id=user_id)
                .on_conflict_do_update(
                    index_elements=["session_id", "viewer_user_id"],
                    set_={
                        "status": case(
                            (ShareViewer.status == ViewerStatus.REVOKED, ViewerStatus.PENDING),
                            else_=ShareViewer.status,
                        ),
                        "revoked_at": case(
                            (ShareViewer.status == ViewerStatus.REVOKED, None),
                            else_=ShareViewer.revoked_at,
                        ),
                        "requested_at": now,
                    },
                )
                .returning(ShareViewer.id, ShareViewer.status)
            )
        ).one()
    else:
        assert guest_label is not None
        guest_token, token_hash = codes.new_guest_token()
        viewer = (
            await session.execute(
                insert(ShareViewer)
                .values(
                    session_id=claimed.session_id,
                    guest_label=guest_label,
                    guest_token_hash=token_hash,
                )
                .returning(ShareViewer.id, ShareViewer.status)
            )
        ).one()

    await session.commit()
    return Redeemed(claimed.session_id, viewer.id, ViewerStatus(viewer.status), guest_token)


async def approve(session: AsyncSession, share_id: uuid.UUID, viewer_id: uuid.UUID) -> bool:
    granted = (
        await session.execute(
            update(ShareViewer)
            .where(
                ShareViewer.id == viewer_id,
                ShareViewer.session_id == share_id,
                ShareViewer.status == ViewerStatus.PENDING,
            )
            .values(status=ViewerStatus.GRANTED, granted_at=datetime.now(UTC))
            .returning(ShareViewer.id)
        )
    ).scalar_one_or_none()
    await session.commit()
    return granted is not None
