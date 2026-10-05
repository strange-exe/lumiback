"""Viewer access changes that must happen together with other actions."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import SessionStatus, ShareSession, ShareViewer, ViewerStatus


async def revoke_user_from_sharer(
    session: AsyncSession, sharer_id: uuid.UUID, viewer_user_id: uuid.UUID
) -> list[uuid.UUID]:
    """Revoke a user's access to every active session of a sharer.

    Called when a contact is removed from either side: losing the contact must also end any
    access it granted. Returns the affected session ids (to notify live connections).
    """
    active = select(ShareSession.id).where(
        ShareSession.sharer_id == sharer_id, ShareSession.status == SessionStatus.ACTIVE
    )
    result = await session.execute(
        update(ShareViewer)
        .where(
            ShareViewer.session_id.in_(active),
            ShareViewer.viewer_user_id == viewer_user_id,
            ShareViewer.status != ViewerStatus.REVOKED,
        )
        .values(status=ViewerStatus.REVOKED, revoked_at=datetime.now(UTC))
        .returning(ShareViewer.session_id)
    )
    return list(result.scalars())
