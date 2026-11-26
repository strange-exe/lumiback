"""Outing rules: when a student may go out, and when they must be back.

Each hostel follows a rule set (e.g. "Boys' hostels"); students without a hostel follow the
campus default. A rule set has one DayRule per day type: weekday, Saturday, Sunday, holiday
(an admin-marked date, whatever weekday it falls on). Times are on the campus clock (IST).

- Tap-out is allowed from `opens_at` until `return_by`.
- Back by `return_by`; later than that is recorded as late (and highlighted to admins).
- `max_minutes` caps the outing (weekends), never past `return_by`; a student may ask for less
  on their request (`requested_minutes`).
- `needs_form`: an approved outing request for the day is required (checked by the caller),
  except from `no_form_from` on: that part of the day works like a weekday evening (no form,
  no maximum).
- Once out, the return time never changes (no extensions).

The pure functions below take everything as arguments, so the rules are tested without a
database; `today_window` loads the student's rules.
"""

import math
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CampusSettings, DayRule, DayType, Holiday, Hostel, RuleSet, User

IST = timezone(timedelta(hours=5, minutes=30), "IST")
MIN_AHEAD = timedelta(minutes=1)
# The student's late "are you OK?" alert, this long past the due time (escalations.py). Here so
# outings.py can read it without importing escalations (which imports outings).
LATE_ALERT_AFTER = timedelta(minutes=30)
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
    no_form_from: datetime | None = None

    @property
    def label(self) -> str:
        return self.holiday or LABEL[self.day_type]

    def free_at(self, now: datetime) -> bool:
        """In the no-form part of a form day."""
        return self.needs_form and self.no_form_from is not None and now >= self.no_form_from

    def form_needed_at(self, now: datetime) -> bool:
        return self.needs_form and not self.free_at(now)


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
        no_form_from=at(day, rule.no_form_from) if rule.no_form_from else None,
    )


def clock(moment: datetime) -> str:
    """'6:00 PM' on the campus clock (portable: no platform strftime flags)."""
    t = moment.astimezone(IST)
    return f"{t.hour % 12 or 12}:{t.minute:02d} {'AM' if t.hour < 12 else 'PM'}"


def duration(minutes: int) -> str:
    """'3 h', '1 h 30 min', '30 min'."""
    hours, rest = divmod(minutes, 60)
    if not hours:
        return f"{rest} min"
    return f"{hours} h {rest} min" if rest else f"{hours} h"


def return_time(w: Window, now: datetime, *, requested_minutes: int | None = None) -> datetime:
    """When the student must be back if they tap out at `now`; raises Refused if they can't."""
    if now < w.opens:
        raise Refused(f"{w.label} outings start at {clock(w.opens)}.")
    if now >= w.return_by:
        raise Refused(f"{w.label} outings end at {clock(w.return_by)}. Try again tomorrow.")
    latest = w.return_by
    # The day's maximum and a shorter time the student asked for, whichever is shorter (the
    # no-form part of a form day has neither).
    caps = [m for m in (w.max_minutes, requested_minutes) if m is not None]
    if caps and not w.free_at(now):
        latest = min(latest, now + timedelta(minutes=min(caps)))
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


async def window_in(session: AsyncSession, rule_set: RuleSet, day: date) -> Window:
    """A rule set's window on `day` (holidays included)."""
    holiday = await session.get(Holiday, day)
    kind = day_type_of(day, holiday is not None)
    rule = await session.get(DayRule, (rule_set.id, kind))
    if rule is None:
        raise Refused("Outing rules aren't set up for today. Ask the hostel office.")
    return window_of(rule, rule_set.name, day, holiday.name if holiday else None)


async def window_for(session: AsyncSession, user: User, day: date) -> Window:
    """The student's window on `day` (their hostel's rules, or the campus default)."""
    rule_set = await rule_set_for(session, user)
    if rule_set is None:
        raise Refused("Outing rules aren't set up yet. Ask the hostel office.")
    return await window_in(session, rule_set, day)


async def today_window(session: AsyncSession, user: User, now: datetime) -> Window:
    return await window_for(session, user, ist_date(now))


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


# ---------- the rules in words (the hostel board's draft) ----------
#
# The wording matches the app's rules screen (apps/mobile/src/lib/office.ts dayLine and
# DAY_LABEL): a rule reads the same there and in a board post drafted from it. tests/
# test_rules.py and office.test.ts assert the same cases. Built from code points, never typed.
EN_DASH = chr(0x2013)
SEPARATOR = f" {chr(0xB7)} "  # a middle dot between spaces
DAY_LABELS = {
    DayType.WEEKDAY: "Weekdays",
    DayType.SATURDAY: "Saturday",
    DayType.SUNDAY: "Sunday",
    DayType.HOLIDAY: "Holidays",
}
_WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
# What a board post may hold (schemas.BoardPostIn): a draft past these can't be sent as is.
BOARD_TITLE_MAX = 60
BOARD_BODY_MAX = 600
BOARD_BODY_LINES = 20
DRAFT_TITLE = "Outing timings"
NO_HOSTEL = "Students without a hostel"


def short_date(day: date) -> str:
    """'Tue 24 Nov' (English names, whatever the server's locale)."""
    return f"{_WEEKDAYS[day.weekday()]} {day.day} {_MONTHS[day.month - 1]}"


def _clock_of(t: time) -> str:
    """'18:00' -> '6:00 PM', like office.ts clock()."""
    return f"{t.hour % 12 or 12}:{t.minute:02d} {'AM' if t.hour < 12 else 'PM'}"


def _hours(minutes: int) -> str:
    """Hours to one decimal, as dayLine's Math.round(minutes / 60 * 10) / 10 prints them
    (halves round up; a whole number has no decimal): 90 -> '1.5', 45 -> '0.8', 180 -> '3'."""
    tenths = math.floor(minutes / 60 * 10 + 0.5)
    whole, tenth = divmod(tenths, 10)
    return f"{whole}.{tenth}" if tenth else str(whole)


def day_line(rule: DayRule) -> str:
    """One day's rules in words, exactly as office.ts dayLine(): the maximum and the no-form
    evening show only on form days."""
    parts = [f"{_clock_of(rule.opens_at)}{EN_DASH}{_clock_of(rule.return_by)}"]
    if rule.needs_form:
        parts.append("needs approval")
        if rule.max_minutes:
            parts.append(f"up to {_hours(rule.max_minutes)} h")
        if rule.no_form_from:
            parts.append(f"no form needed from {_clock_of(rule.no_form_from)}")
    else:
        parts.append("no form needed")
    return SEPARATOR.join(parts)


def _and(words: list[str]) -> str:
    """['A'] -> 'A'; ['A', 'B'] -> 'A and B'; ['A', 'B', 'C'] -> 'A, B and C'."""
    return words[0] if len(words) == 1 else f"{', '.join(words[:-1])} and {words[-1]}"


def labelled_lines(rules: list[DayRule]) -> list[str]:
    """A rule set's day lines in day order, with neighbouring days that read the same on one
    line ('Weekdays and Saturday: ...'). Only days next to each other merge."""
    order = list(DayType)
    groups: list[tuple[list[DayType], str]] = []
    for rule in sorted(rules, key=lambda r: order.index(r.day_type)):
        line = day_line(rule)
        if (
            groups
            and groups[-1][1] == line
            and order.index(groups[-1][0][-1]) + 1 == order.index(rule.day_type)
        ):
            groups[-1][0].append(rule.day_type)
        else:
            groups.append(([rule.day_type], line))
    return [f"{_and([DAY_LABELS[d] for d in days])}: {line}" for days, line in groups]


@dataclass(frozen=True)
class Draft:
    """A board post drafted from the outing rules. `too_long`: it can't be sent as drafted
    (the sender trims it first; the form shows the counter in error)."""

    title: str
    body: str
    too_long: bool


def _draft(title: str, body: str) -> Draft:
    too_long = (
        len(title) > BOARD_TITLE_MAX
        or len(body) > BOARD_BODY_MAX
        or body.count("\n") + 1 > BOARD_BODY_LINES
    )
    return Draft(title=title, body=body, too_long=too_long)


# A block: who it is for (hostel names, or NO_HOSTEL) and their rule set's day rules.
Block = tuple[str, list[DayRule]]


def timings_draft(today: date, blocks: list[Block]) -> Draft:
    """'Outing timings from Tue 24 Nov:' then the rules: one rule set's lines as they are;
    several rule sets each under a heading naming who follows it, a blank line between."""
    header = f"Outing timings from {short_date(today)}:"
    blocks = [(heading, rules) for heading, rules in blocks if rules]
    if len(blocks) == 1:
        body = "\n".join([header, *labelled_lines(blocks[0][1])])
    else:
        body = header + "".join(
            f"\n\n{heading}:\n" + "\n".join(labelled_lines(rules)) for heading, rules in blocks
        )
    return _draft(DRAFT_TITLE, body)


def holiday_draft(name: str, day: date, blocks: list[Block]) -> Draft:
    """'<holiday> on Fri 25 Dec', and each rule set's holiday line."""
    lines = [
        (heading, day_line(rule))
        for heading, rules in blocks
        for rule in rules
        if rule.day_type == DayType.HOLIDAY
    ]
    if len(blocks) == 1 and len(lines) == 1:
        body = f"Holiday hours: {lines[0][1]}"
    else:
        body = "\n".join(["Holiday hours:", *(f"{heading}: {line}" for heading, line in lines)])
    return _draft(f"{name} on {short_date(day)}", body)
