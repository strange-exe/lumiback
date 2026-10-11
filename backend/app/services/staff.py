"""The hostel office: admins (every hostel) and wardens (only the hostels assigned to them).

Every staff read and action on students goes through `Staff.covers`, so a warden never sees,
approves or resolves anything for a student outside their hostels. Students without a hostel
are covered by admins only.
"""

import uuid
from dataclasses import dataclass

from sqlalchemy import ColumnElement, false, select, true
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User, UserRole, WardenHostel


@dataclass(frozen=True)
class Staff:
    user: User
    hostels: frozenset[uuid.UUID] | None  # None: every hostel (an admin)

    @property
    def is_admin(self) -> bool:
        return self.hostels is None

    def covers(self, hostel_id: ColumnElement[uuid.UUID | None]) -> ColumnElement[bool]:
        """A WHERE clause limiting rows to students this staff member looks after."""
        if self.hostels is None:
            return true()
        if not self.hostels:
            return false()
        return hostel_id.in_(self.hostels)

    def covers_student(self, student: User) -> bool:
        return self.hostels is None or student.hostel_id in self.hostels


async def warden_hostel_ids(session: AsyncSession, user_id: uuid.UUID) -> frozenset[uuid.UUID]:
    rows = await session.scalars(
        select(WardenHostel.hostel_id).where(WardenHostel.user_id == user_id)
    )
    return frozenset(rows)


async def staff_of(session: AsyncSession, user: User) -> Staff | None:
    """None for students."""
    if user.role == UserRole.ADMIN:
        return Staff(user, None)
    if user.role == UserRole.WARDEN:
        return Staff(user, await warden_hostel_ids(session, user.id))
    return None


async def office_for(session: AsyncSession, hostel_id: uuid.UUID | None) -> list[User]:
    """Who to tell about a student: their hostel's wardens, or the admins if it has none."""
    if hostel_id is not None:
        wardens = list(
            await session.scalars(
                select(User)
                .join(WardenHostel, WardenHostel.user_id == User.id)
                .where(
                    WardenHostel.hostel_id == hostel_id,
                    User.role == UserRole.WARDEN,
                    User.email_verified_at.is_not(None),
                )
            )
        )
        if wardens:
            return wardens
    return list(
        await session.scalars(
            select(User).where(User.role == UserRole.ADMIN, User.email_verified_at.is_not(None))
        )
    )
