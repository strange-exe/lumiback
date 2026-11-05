"""The student's own profile details that the outing rules need: hostel and contacts."""

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy import select

from app.api.deps import CurrentUser, LimiterDep, SessionDep, enforce
from app.models import Hostel, RuleSet, User, UserRole
from app.schemas import HostelChoiceOut, ProfileIn, ProfileOut
from app.security.rate_limit import Limit
from app.services import outings
from app.services.export import export_user

router = APIRouter(tags=["profile"])

# Building the export reads every table: generous for a person, a wall for a loop.
EXPORT_PER_USER = Limit(max_hits=5, window_seconds=3600)


def hostel_locked(user: User) -> bool:
    """A student picks their hostel once; after that only the hostel office moves them, so
    nobody can switch to a hostel with easier rules or a different warden on their own."""
    return user.role == UserRole.STUDENT and user.hostel_id is not None


async def _out(session, user: User) -> ProfileOut:
    hostel = await session.get(Hostel, user.hostel_id) if user.hostel_id else None
    return ProfileOut(
        hostel_id=user.hostel_id,
        hostel=hostel.name if hostel else None,
        hostel_locked=hostel_locked(user),
        phone=user.phone,
        emergency_name=user.emergency_name,
        emergency_relation=user.emergency_relation,
        emergency_phone=user.emergency_phone,
    )


@router.get("/hostels")
async def hostel_choices(_: CurrentUser, session: SessionDep) -> list[HostelChoiceOut]:
    rows = (
        await session.execute(
            select(Hostel.id, Hostel.name, RuleSet.name)
            .join(RuleSet, RuleSet.id == Hostel.rule_set_id)
            .order_by(Hostel.name)
        )
    ).all()
    return [HostelChoiceOut(id=i, name=n, rule_set=r) for i, n, r in rows]


@router.get("/profile")
async def get_profile(me: CurrentUser, session: SessionDep) -> ProfileOut:
    return await _out(session, me)


@router.get("/profile/export")
async def export_my_data(me: CurrentUser, session: SessionDep, limiter: LimiterDep) -> JSONResponse:
    """Everything kept about the signed-in person, as a JSON file to save (any role)."""
    await enforce(limiter, "export:user", str(me.id), EXPORT_PER_USER)
    data = await export_user(session, me)
    day = datetime.now(UTC).date().isoformat()
    return JSONResponse(
        jsonable_encoder(data),
        headers={
            "Content-Disposition": f'attachment; filename="lumiback-data-{day}.json"',
            "Cache-Control": "no-store",
        },
    )


@router.patch("/profile")
async def update_profile(body: ProfileIn, me: CurrentUser, session: SessionDep) -> ProfileOut:
    if "hostel_id" in body.model_fields_set and body.hostel_id != me.hostel_id:
        if hostel_locked(me):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                detail="Your hostel is set. Ask the hostel office if you've moved.",
            )
        if body.hostel_id is not None and await session.get(Hostel, body.hostel_id) is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Unknown hostel")
        if await outings.rules_in_use(session, me):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail="You can't change your hostel while you're out or have an outing request "
                "for today. Ask the hostel office.",
            )
        me.hostel_id = body.hostel_id
    if body.contacts is not None:
        for field, value in body.contacts.model_dump().items():
            setattr(me, field, value)
    await session.commit()
    return await _out(session, me)
