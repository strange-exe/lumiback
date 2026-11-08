"""The hostel office: admins and head wardens (every hostel), and wardens (only the hostels
assigned to them).

Every staff read and action on students goes through `Staff.covers`, so a warden never sees,
approves or resolves anything for a student outside their hostels. Students without a hostel
are covered by admins and head wardens only. Outing rules are changed by admins and head
wardens (`can_edit_rules`); gates, roles and settings by admins only.
"""

import uuid
from dataclasses import dataclass

from sqlalchemy import ColumnElement, and_, exists, false, or_, select, true, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Escalation, Outing, User, UserRole, WardenHostel

# Roles that look after every hostel's students.
EVERY_HOSTEL = (UserRole.ADMIN, UserRole.DEVELOPER, UserRole.HEAD_WARDEN)


@dataclass(frozen=True)
class Staff:
    user: User
    hostels: frozenset[uuid.UUID] | None  # None: every hostel (an admin or head warden)

    @property
    def every_hostel(self) -> bool:
        return self.hostels is None

    @property
    def can_edit_rules(self) -> bool:
        return self.user.role in EVERY_HOSTEL

    def covers(self, hostel_id: ColumnElement[uuid.UUID | None]) -> ColumnElement[bool]:
        """A WHERE clause limiting rows to students this staff member looks after."""
        if self.hostels is None:
            return true()
        if not self.hostels:
            return false()
        return hostel_id.in_(self.hostels)

    def covers_student(self, student: User) -> bool:
        return self.covers_hostel(student.hostel_id)

    def covers_hostel(self, hostel_id: uuid.UUID | None) -> bool:
        """For one record: an outing belongs to the hostel the student was in at the time."""
        return self.hostels is None or hostel_id in self.hostels


async def warden_hostel_ids(session: AsyncSession, user_id: uuid.UUID) -> frozenset[uuid.UUID]:
    rows = await session.scalars(
        select(WardenHostel.hostel_id).where(WardenHostel.user_id == user_id)
    )
    return frozenset(rows)


async def staff_of(session: AsyncSession, user: User) -> Staff | None:
    """None for students."""
    if user.role in EVERY_HOSTEL:
        return Staff(user, None)
    if user.role == UserRole.WARDEN:
        return Staff(user, await warden_hostel_ids(session, user.id))
    return None


async def _verified(session: AsyncSession, role: UserRole) -> list[User]:
    return list(
        await session.scalars(
            select(User).where(
                User.role == role,
                User.email_verified_at.is_not(None),
                User.deactivated_at.is_(None),
            )
        )
    )


async def office_for(session: AsyncSession, hostel_id: uuid.UUID | None) -> list[User]:
    """Who decides a student's request: their hostel's wardens; if it has none, the head
    wardens; if there are none either, the admins."""
    # A warden turned off doesn't count: their hostel falls back.
    return await hostel_wardens(session, hostel_id) or await head_office(session)


async def head_office(session: AsyncSession) -> list[User]:
    """The second tier of the hostel office: the head wardens; if there are none, the admins.
    (Developers are not campus staff: they're never sent the office's alerts.)"""
    return await _verified(session, UserRole.HEAD_WARDEN) or await _verified(
        session, UserRole.ADMIN
    )


def claim_is_live(hostel_id: ColumnElement[uuid.UUID | None]) -> ColumnElement[bool]:
    """SQL: the escalation's claimer can still act on it: their account is on, and they look
    after `hostel_id` (the outing's hostel), as every-hostel staff or as its warden. A claim
    that isn't live has lapsed: the re-alerts and the hand-over go on, and anyone covering the
    hostel may take it (services/escalations.py)."""
    return exists().where(
        User.id == Escalation.claimed_by,
        User.deactivated_at.is_(None),
        or_(
            User.role.in_(EVERY_HOSTEL),
            and_(
                User.role == UserRole.WARDEN,
                exists().where(
                    WardenHostel.user_id == User.id, WardenHostel.hostel_id == hostel_id
                ),
            ),
        ),
    )


async def clear_lapsed_claims(session: AsyncSession) -> None:
    """Drops every open escalation's claim whose claimer can no longer act on it (the caller
    commits). Run after turning an account off, changing a role or a warden's hostels, or
    deleting a hostel, so nobody stays "on it" who can't be."""
    await session.flush()  # the change that made them lapse
    hostel = select(Outing.hostel_id).where(Outing.id == Escalation.outing_id).scalar_subquery()
    await session.execute(
        update(Escalation)
        .where(
            Escalation.resolved_at.is_(None),
            Escalation.claimed_by.is_not(None),
            ~claim_is_live(hostel),
        )
        .values(claimed_by=None, claimed_at=None)
        .execution_options(synchronize_session=False)
    )


async def hostel_wardens(session: AsyncSession, hostel_id: uuid.UUID | None) -> list[User]:
    """The hostel's own wardens (signed up, not turned off); none for no hostel."""
    if hostel_id is None:
        return []
    return list(
        await session.scalars(
            select(User)
            .join(WardenHostel, WardenHostel.user_id == User.id)
            .where(
                WardenHostel.hostel_id == hostel_id,
                User.role == UserRole.WARDEN,
                User.email_verified_at.is_not(None),
                User.deactivated_at.is_(None),
            )
        )
    )
