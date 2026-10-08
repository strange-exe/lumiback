"""The outing rules on their own: every day type, the window edges, the 8:30 PM option and
weekend maximums. No database: rules are plain values here."""

from datetime import date, datetime, time

import pytest

from app.models import DayRule, DayType
from app.services.rules import IST, Refused, Window, clock, day_type_of, return_time, window_of

THU = date(2026, 10, 8)
SAT = date(2026, 10, 10)
SUN = date(2026, 10, 11)


def ist(day: date, hhmm: str) -> datetime:
    return datetime.combine(day, time.fromisoformat(hhmm), tzinfo=IST)


def weekday(late: bool = True) -> DayRule:
    return DayRule(
        day_type=DayType.WEEKDAY,
        opens_at=time(18),
        return_by=time(20),
        late_until=time(20, 30) if late else None,
        max_minutes=None,
        needs_form=False,
    )


def weekend(day_type: DayType = DayType.SATURDAY, max_minutes: int = 180) -> DayRule:
    return DayRule(
        day_type=day_type,
        opens_at=time(10),
        return_by=time(20),
        late_until=None,
        max_minutes=max_minutes,
        needs_form=True,
    )


def win(rule: DayRule, day: date = THU, holiday: str | None = None) -> Window:
    return window_of(rule, "Boys' hostels", day, holiday)


def test_day_types():
    assert day_type_of(THU, False) is DayType.WEEKDAY
    assert day_type_of(SAT, False) is DayType.SATURDAY
    assert day_type_of(SUN, False) is DayType.SUNDAY
    assert day_type_of(THU, True) is DayType.HOLIDAY  # a holiday wins over the weekday
    assert day_type_of(SUN, True) is DayType.HOLIDAY


def test_weekday_back_by_8_pm():
    assert return_time(win(weekday()), ist(THU, "18:00")) == ist(THU, "20:00")
    assert return_time(win(weekday()), ist(THU, "19:58")) == ist(THU, "20:00")


def test_weekday_8_30_option_where_allowed():
    assert return_time(win(weekday()), ist(THU, "18:30"), late=True) == ist(THU, "20:30")


def test_weekday_8_30_option_refused_where_not_allowed():
    with pytest.raises(Refused, match="don't include returning after 8:00 PM"):
        return_time(win(weekday(late=False)), ist(THU, "18:30"), late=True)


@pytest.mark.parametrize("hhmm", ["09:00", "17:59"])
def test_weekday_before_the_window_is_refused(hhmm):
    with pytest.raises(Refused, match="Weekday outings start at 6:00 PM"):
        return_time(win(weekday()), ist(THU, hhmm))


@pytest.mark.parametrize("hhmm", ["20:00", "20:15", "23:00"])
def test_weekday_after_the_window_is_refused_even_with_the_late_option(hhmm):
    with pytest.raises(Refused, match="end at 8:00 PM"):
        return_time(win(weekday()), ist(THU, hhmm), late=True)


def test_last_minute_is_refused():
    with pytest.raises(Refused):
        return_time(win(weekday()), ist(THU, "19:59").replace(second=30))


def test_weekend_max_duration():
    assert return_time(win(weekend(), SAT), ist(SAT, "11:00")) == ist(SAT, "14:00")


def test_weekend_never_past_return_by():
    assert return_time(win(weekend(max_minutes=300), SUN), ist(SUN, "17:00")) == ist(SUN, "20:00")


def test_weekend_shorter_on_request_but_never_longer():
    w = win(weekend(max_minutes=300), SUN)
    assert return_time(w, ist(SUN, "11:00"), requested_minutes=120) == ist(SUN, "13:00")
    assert return_time(w, ist(SUN, "11:00"), requested_minutes=600) == ist(SUN, "16:00")


def test_holiday_label_uses_its_name():
    w = win(weekend(DayType.HOLIDAY, 300), THU, holiday="Diwali")
    with pytest.raises(Refused, match="Diwali outings start at 10:00 AM"):
        return_time(w, ist(THU, "08:00"))


def test_clock_is_on_the_campus_clock():
    assert clock(ist(THU, "18:00")) == "6:00 PM"
    assert clock(ist(THU, "00:05")) == "12:05 AM"
    assert clock(datetime.fromisoformat("2026-10-08T12:30:00+00:00")) == "6:00 PM"
