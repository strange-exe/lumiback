"""The student's own profile details that the outing rules need: hostel and contacts."""

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import and_, exists, or_, select

from app.api.deps import CurrentUser, SessionDep
from app.models import Hostel, Outing, OutingRequest, RequestStatus, RuleSet, User
from app.schemas import HostelChoiceOut, ProfileIn, ProfileOut
from app.services import outings, rules

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


async def _rules_in_use(session, user: User) -> bool:
    """Out now, or a live request today (waiting, or approved and not yet used): the hostel's
    rules (return time, maximum, the office that approved it) already apply, so switching
    hostels would change them midway. A used approval is spent once its outing is over."""
    if await outings.current(session, user.id) is not None:
        return True
    used = exists().where(Outing.request_id == OutingRequest.id)
    return bool(
        await session.scalar(
            select(
                exists().where(
                    OutingRequest.student_id == user.id,
                    OutingRequest.day == rules.ist_date(datetime.now(UTC)),
                    or_(
                        OutingRequest.status == RequestStatus.PENDING,
                        and_(OutingRequest.status == RequestStatus.APPROVED, ~used),
                    ),
                )
            )
        )
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
        if body.hostel_id is not None and await session.get(Hostel, body.hostel_id) is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Unknown hostel")
        if await _rules_in_use(session, me):
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
