"""Running late (wave 3 #8; owner 2026-11-08: "Yes, within a cap").

A student who is out tells the hostel office they'll be back 15, 30 or 60 minutes later, with
an optional short reason. Rules:
- once per outing, so never more than 60 minutes in all (the database checks it too:
  ck_outings_running_late_once_within_cap);
- until the late "are you OK?" alert is due (30 min past the due time, by the clock, even if
  the sweep hasn't sent it yet): after that the alert and the escalation are running, and the
  student answers them instead;
- only to a time still ahead (being 20 min late, "15 more" is already past).

The due time itself moves (outings.expected_return_at), with the time before it kept
(original_return_at), so everything that reads the due time, the late alert, the escalation,
"overdue" and tonight's late list, runs from the new time. The office sees both times and the
reason; followers see the new time.

The outing row is locked while it's checked and moved, and the sweep marks the late alert with
a conditional UPDATE on the same row: whichever comes second sees the other's change (a move
after the alert is refused; an alert after a move waits for the new time).
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Outing, User
from app.services import alerts, followers
from app.services.outings import RUNNING_LATE_CHOICES
from app.services.rules import LATE_ALERT_AFTER

ALREADY = "You've already told the hostel office you're running late on this outing."
ALERT_GONE = "The late alert has already gone out. Answer it, or call the hostel office."
PASSED = "That time has already passed. Choose a longer time."


class NotOut(Exception):
    pass


class Refused(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


@dataclass(frozen=True)
class Moved:
    outing: Outing
    alerts: list[int]  # the office and followers told (send after the commit)


async def tell(
    session: AsyncSession, student: User, minutes: int, reason: str | None, web_url: str
) -> Moved:
    """Moves the student's open outing's due time by `minutes` and queues the alerts; the
    caller commits, then sends them."""
    if minutes not in RUNNING_LATE_CHOICES:
        raise ValueError(minutes)
    outing = await session.scalar(
        select(Outing)
        .where(Outing.student_id == student.id, Outing.returned_at.is_(None))
        .with_for_update()
    )
    if outing is None:
        raise NotOut
    now = datetime.now(UTC)
    if outing.running_late_at is not None:
        raise Refused(ALREADY)
    if (
        outing.overdue_notified_at is not None
        or now >= outing.expected_return_at + LATE_ALERT_AFTER
    ):
        raise Refused(ALERT_GONE)  # sent, or due and the sweep just hasn't got to it
    new_due = outing.expected_return_at + timedelta(minutes=minutes)
    if new_due <= now:
        raise Refused(PASSED)
    outing.original_return_at = outing.expected_return_at
    outing.expected_return_at = new_due
    outing.running_late_minutes = minutes
    outing.running_late_reason = reason
    outing.running_late_at = now
    await session.flush()
    told = await alerts.running_late(session, student, outing, web_url)
    told += await followers.running_late(session, student, outing, now, web_url)
    return Moved(outing, told)
