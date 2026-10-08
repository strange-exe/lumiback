"""The student's own profile details that the outing rules need: hostel and contacts."""

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import CurrentUser, SessionDep
from app.models import Hostel, RuleSet, User
from app.schemas import HostelChoiceOut, ProfileIn, ProfileOut

router = APIRouter(tags=["profile"])


async def _out(session, user: User) -> ProfileOut:
    hostel = await session.get(Hostel, user.hostel_id) if user.hostel_id else None
    return ProfileOut(
        hostel_id=user.hostel_id,
        hostel=hostel.name if hostel else None,
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
    if "hostel_id" in body.model_fields_set:
        if body.hostel_id is not None and await session.get(Hostel, body.hostel_id) is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Unknown hostel")
        me.hostel_id = body.hostel_id
    if body.contacts is not None:
        for field, value in body.contacts.model_dump().items():
            setattr(me, field, value)
    await session.commit()
    return await _out(session, me)
