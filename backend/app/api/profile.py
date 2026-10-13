"""The student's own profile details that the outing rules need: hostel and contacts."""

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import CurrentUser, SessionDep
from app.models import Hostel, RuleSet, User, UserRole
from app.schemas import HostelChoiceOut, ProfileIn, ProfileOut
from app.services import outings

router = APIRouter(tags=["profile"])


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
