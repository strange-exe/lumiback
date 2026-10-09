"""Outing rules: when a student may go out, and when they must be back.

Each hostel follows a rule set (e.g. "Boys' hostels"); students without a hostel follow the
campus default. A rule set has one DayRule per day type: weekday, Saturday, Sunday, holiday
(an admin-marked date, whatever weekday it falls on). Times are on the campus clock (IST).

- Tap-out is allowed from `opens_at` until `return_by`.
- Back by `return_by`; later than that is recorded as late (and highlighted to admins).
- `max_minutes` caps the outing (weekends), never past `return_by`.
- `needs_form`: an approved outing request for the day is required (checked by the caller).
- Once out, the return time never changes (no extensions).

The pure functions below take everything as arguments, so the rules are tested without a
database; `today_window` loads the student's rules.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CampusSettings, DayRule, DayType, Holiday, Hostel, RuleSet, User

IST = timezone(timedelta(hours=5, minutes=30), "IST")
MIN_AHEAD = timedelta(minutes=1)
LABEL = {
    DayType.WEEKDAY: "Weekday",
    DayType.SATURDAY: "Saturday",
    DayType.SUNDAY: "Sunday",
    DayType.HOLIDAY: "Holiday",
}


class Refused(Exception):
    """The rules don't allow this tap-out; `message` is written for the student."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


@dataclass(frozen=True)
class Window:
    """One student's rules for one day, as instants."""

    day: date
    day_type: DayType
    holiday: str | None  # the holiday's name, on holidays
    rule_set: str
    opens: datetime
    return_by: datetime
    max_minutes: int | None
    needs_form: bool

    @property
    def label(self) -> str:
        return self.holiday or LABEL[self.day_type]


def ist_date(now: datetime) -> date:
    return now.astimezone(IST).date()


def day_type_of(day: date, is_holiday: bool) -> DayType:
    if is_holiday:
        return DayType.HOLIDAY
    return {5: DayType.SATURDAY, 6: DayType.SUNDAY}.get(day.weekday(), DayType.WEEKDAY)


def at(day: date, clock: time) -> datetime:
    """A campus-clock time on `day`, as an aware instant."""
    return datetime.combine(day, clock, tzinfo=IST)


def window_of(rule: DayRule, rule_set: str, day: date, holiday: str | None) -> Window:
    return Window(
        day=day,
        day_type=rule.day_type,
        holiday=holiday,
        rule_set=rule_set,
        opens=at(day, rule.opens_at),
        return_by=at(day, rule.return_by),
        max_minutes=rule.max_minutes,
        needs_form=rule.needs_form,
    )


def clock(moment: datetime) -> str:
    """'6:00 PM' on the campus clock (portable: no platform strftime flags)."""
    t = moment.astimezone(IST)
    return f"{t.hour % 12 or 12}:{t.minute:02d} {'AM' if t.hour < 12 else 'PM'}"


def return_time(w: Window, now: datetime, *, requested_minutes: int | None = None) -> datetime:
    """When the student must be back if they tap out at `now`; raises Refused if they can't."""
    if now < w.opens:
        raise Refused(f"{w.label} outings start at {clock(w.opens)}.")
    if now >= w.return_by:
        raise Refused(f"{w.label} outings end at {clock(w.return_by)}. Try again tomorrow.")
    latest = w.return_by
    if w.max_minutes is not None:
        minutes = min(w.max_minutes, requested_minutes or w.max_minutes)
        latest = min(latest, now + timedelta(minutes=minutes))
    if latest < now + MIN_AHEAD:
        raise Refused(f"{w.label} outings end at {clock(w.return_by)}. Try again tomorrow.")
    return latest


async def rule_set_for(session: AsyncSession, user: User) -> RuleSet | None:
    """The student's hostel's rule set, or the campus default."""
    if user.hostel_id is not None:
        hostel = await session.get(Hostel, user.hostel_id)
        if hostel is not None:
            return await session.get(RuleSet, hostel.rule_set_id)
    settings = await session.get(CampusSettings, 1)
    if settings is None or settings.default_rule_set_id is None:
        return None
    return await session.get(RuleSet, settings.default_rule_set_id)


async def today_window(session: AsyncSession, user: User, now: datetime) -> Window:
    day = ist_date(now)
    rule_set = await rule_set_for(session, user)
    if rule_set is None:
        raise Refused("Outing rules aren't set up yet. Ask the hostel office.")
    holiday = await session.get(Holiday, day)
    kind = day_type_of(day, holiday is not None)
    rule = await session.get(DayRule, (rule_set.id, kind))
    if rule is None:
        raise Refused("Outing rules aren't set up for today. Ask the hostel office.")
    return window_of(rule, rule_set.name, day, holiday.name if holiday else None)


async def rule_sets(session: AsyncSession) -> list[tuple[RuleSet, list[DayRule]]]:
    sets = (await session.execute(select(RuleSet).order_by(RuleSet.name))).scalars().all()
    rules = (await session.execute(select(DayRule))).scalars().all()
    by_set: dict[uuid.UUID, list[DayRule]] = {}
    for r in rules:
        by_set.setdefault(r.rule_set_id, []).append(r)
    order = list(DayType)
    return [(s, sorted(by_set.get(s.id, []), key=lambda r: order.index(r.day_type))) for s in sets]


def utc(moment: datetime) -> datetime:
    return moment.astimezone(UTC)
