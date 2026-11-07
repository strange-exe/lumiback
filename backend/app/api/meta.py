"""GET /meta/status: the developer's status panel (web Status page, the app's Profile).

Which API build is running and whether the database has every migration. Real developers only:
the check reads the account itself, so it also answers a developer viewing the app as a role
(a GET, which view as allows). Deliberately small: no settings, addresses, hostnames or errors
are ever passed on.
"""

import asyncio
from datetime import UTC, datetime
from functools import cache
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, SessionDep, SettingsDep
from app.models import UserRole

router = APIRouter(prefix="/meta", tags=["meta"])

ALEMBIC_INI = Path(__file__).resolve().parents[2] / "alembic.ini"
DEVELOPERS = "Developers only"
REVISION_TIMEOUT_SECONDS = 3.0


class DatabaseStatus(BaseModel):
    reachable: bool
    revision: str | None
    head: str | None
    up_to_date: bool


class StatusOut(BaseModel):
    api_version: str
    commit: str | None
    database: DatabaseStatus
    server_time: datetime


@cache
def migration_head() -> str | None:
    """The newest revision in migrations/ (read once per process; deploys restart it)."""
    heads = ScriptDirectory.from_config(Config(str(ALEMBIC_INI))).get_heads()
    return ",".join(sorted(heads)) or None


async def read_revision(session: AsyncSession) -> str | None:
    """The revision the database is at (alembic_version)."""
    rows = (await session.execute(text("SELECT version_num FROM alembic_version"))).scalars()
    return ",".join(sorted(rows)) or None


@router.get("/status")
async def meta_status(
    request: Request, user: CurrentUser, session: SessionDep, settings: SettingsDep
) -> StatusOut:
    # `user` is always the real account, also while viewing as a role (api/deps.py).
    if user.role != UserRole.DEVELOPER:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail=DEVELOPERS)
    head = migration_head()
    try:
        async with asyncio.timeout(REVISION_TIMEOUT_SECONDS):
            revision = await read_revision(session)
        reachable = True
    except Exception:  # unreachable or timed out; the reason is never passed on
        revision, reachable = None, False
    return StatusOut(
        api_version=request.app.version,
        commit=settings.render_git_commit,
        database=DatabaseStatus(
            reachable=reachable,
            revision=revision,
            head=head,
            up_to_date=reachable and revision is not None and revision == head,
        ),
        server_time=datetime.now(UTC),
    )
