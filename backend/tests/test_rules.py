"""The outing rules on their own: every day type, the window edges, form-day maximums and the
no-form evening. No database: rules are plain values here."""

from dataclasses import replace
from datetime import date, datetime, time

import pytest

from app.models import DayRule, DayType
from app.services.rules import (
    DAY_LABELS,
    IST,
    Draft,
    Refused,
    Window,
    clock,
    day_line,
    day_type_of,
    duration,
    holiday_draft,
    labelled_lines,
    return_time,
    timings_draft,
    window_of,
)

THU = date(2026, 10, 8)
SAT = date(2026, 10, 10)
SUN = date(2026, 10, 11)


def ist(day: date, hhmm: str) -> datetime:
    return datetime.combine(day, time.fromisoformat(hhmm), tzinfo=IST)


def weekday() -> DayRule:
    return DayRule(
        day_type=DayType.WEEKDAY,
        opens_at=time(18),
        return_by=time(20),
        max_minutes=None,
        needs_form=False,
    )


def weekend(day_type: DayType = DayType.SATURDAY, max_minutes: int = 180) -> DayRule:
    return DayRule(
        day_type=day_type,
        opens_at=time(10),
        return_by=time(20),
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


@pytest.mark.parametrize("hhmm", ["09:00", "17:59"])
def test_weekday_before_the_window_is_refused(hhmm):
    with pytest.raises(Refused, match="Weekday outings start at 6:00 PM"):
        return_time(win(weekday()), ist(THU, hhmm))


@pytest.mark.parametrize("hhmm", ["20:00", "20:15", "23:00"])
def test_weekday_after_the_window_is_refused(hhmm):
    with pytest.raises(Refused, match="end at 8:00 PM"):
        return_time(win(weekday()), ist(THU, hhmm))


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


def boys_sunday() -> DayRule:
    rule = weekend(DayType.SUNDAY)
    rule.no_form_from = time(18)
    return rule


def test_no_form_evening_on_a_form_day():
    w = win(boys_sunday(), SUN)
    assert w.form_needed_at(ist(SUN, "17:59"))
    assert not w.form_needed_at(ist(SUN, "18:00"))
    # Before the evening an approved form's maximum applies; in the evening, only "back by".
    assert return_time(w, ist(SUN, "11:00")) == ist(SUN, "14:00")
    assert return_time(w, ist(SUN, "18:00")) == ist(SUN, "20:00")


def test_form_days_without_an_evening_always_need_the_form():
    w = win(weekend(DayType.SUNDAY), SUN)
    assert w.form_needed_at(ist(SUN, "19:00"))
    assert not win(weekday()).form_needed_at(ist(THU, "18:30"))


def test_holiday_label_uses_its_name():
    w = win(weekend(DayType.HOLIDAY, 300), THU, holiday="Diwali")
    with pytest.raises(Refused, match="Diwali outings start at 10:00 AM"):
        return_time(w, ist(THU, "08:00"))


def test_clock_is_on_the_campus_clock():
    assert clock(ist(THU, "18:00")) == "6:00 PM"
    assert clock(ist(THU, "00:05")) == "12:05 AM"
    assert clock(datetime.fromisoformat("2026-10-08T12:30:00+00:00")) == "6:00 PM"


def test_shorter_on_request_without_a_day_maximum():
    """A form day with no maximum (the window is the limit) still honours a shorter request."""
    w = replace(win(weekend(DayType.HOLIDAY), THU, holiday="Diwali"), max_minutes=None)
    assert return_time(w, ist(THU, "11:00")) == ist(THU, "20:00")
    assert return_time(w, ist(THU, "11:00"), requested_minutes=90) == ist(THU, "12:30")
    assert return_time(w, ist(THU, "19:00"), requested_minutes=90) == ist(THU, "20:00")


def test_the_no_form_evening_ignores_a_requested_duration():
    w = win(boys_sunday(), SUN)
    assert return_time(w, ist(SUN, "18:00"), requested_minutes=60) == ist(SUN, "20:00")


@pytest.mark.parametrize(
    ("minutes", "text"),
    [(30, "30 min"), (60, "1 h"), (90, "1 h 30 min"), (180, "3 h"), (725, "12 h 5 min")],
)
def test_durations_read_naturally(minutes, text):
    assert duration(minutes) == text


# ---------- the rules in words (the hostel board's draft) ----------
#
# The SAME cases are asserted by apps/mobile/src/lib/office.test.ts against office.dayLine():
# a rule reads the same in the app's rules screen and in a board post drafted from it. The
# en dash and middle dot are built from code points, never typed.

DASH, DOT = chr(0x2013), chr(0xB7)
SHARED_DAY_LINES = [
    (
        {
            "day_type": "sunday",
            "opens_at": "10:00",
            "return_by": "20:00",
            "max_minutes": 180,
            "needs_form": True,
            "no_form_from": "18:00",
        },
        f"10:00 AM{DASH}8:00 PM {DOT} needs approval {DOT} up to 3 h {DOT} "
        "no form needed from 6:00 PM",
    ),
    (
        {
            "day_type": "sunday",
            "opens_at": "10:00",
            "return_by": "20:00",
            "max_minutes": None,
            "needs_form": False,
            "no_form_from": None,
        },
        f"10:00 AM{DASH}8:00 PM {DOT} no form needed",
    ),
    (
        {
            "day_type": "sunday",
            "opens_at": "10:00",
            "return_by": "20:00",
            "max_minutes": 90,
            "needs_form": True,
            "no_form_from": None,
        },
        f"10:00 AM{DASH}8:00 PM {DOT} needs approval {DOT} up to 1.5 h",
    ),
    (  # a maximum shows only on form days, as in dayLine
        {
            "day_type": "weekday",
            "opens_at": "18:00",
            "return_by": "20:00",
            "max_minutes": 120,
            "needs_form": False,
            "no_form_from": None,
        },
        f"6:00 PM{DASH}8:00 PM {DOT} no form needed",
    ),
    (  # hours to one decimal, halves rounded up like Math.round: 45 min is 0.75 h -> 0.8 h
        {
            "day_type": "holiday",
            "opens_at": "09:30",
            "return_by": "21:00",
            "max_minutes": 45,
            "needs_form": True,
            "no_form_from": None,
        },
        f"9:30 AM{DASH}9:00 PM {DOT} needs approval {DOT} up to 0.8 h",
    ),
    (
        {
            "day_type": "saturday",
            "opens_at": "00:05",
            "return_by": "12:00",
            "max_minutes": 100,
            "needs_form": True,
            "no_form_from": "11:00",
        },
        f"12:05 AM{DASH}12:00 PM {DOT} needs approval {DOT} up to 1.7 h {DOT} "
        "no form needed from 11:00 AM",
    ),
    (
        {
            "day_type": "weekday",
            "opens_at": "00:00",
            "return_by": "23:59",
            "max_minutes": 720,
            "needs_form": True,
            "no_form_from": None,
        },
        f"12:00 AM{DASH}11:59 PM {DOT} needs approval {DOT} up to 12 h",
    ),
]
SHARED_DAY_LABELS = {
    "weekday": "Weekdays",
    "saturday": "Saturday",
    "sunday": "Sunday",
    "holiday": "Holidays",
}


def rule_of(d: dict) -> DayRule:
    return DayRule(
        day_type=DayType(d["day_type"]),
        opens_at=time.fromisoformat(d["opens_at"]),
        return_by=time.fromisoformat(d["return_by"]),
        max_minutes=d["max_minutes"],
        needs_form=d["needs_form"],
        no_form_from=time.fromisoformat(d["no_form_from"]) if d["no_form_from"] else None,
    )


@pytest.mark.parametrize(("rule", "line"), SHARED_DAY_LINES)
def test_a_day_reads_like_the_apps_day_line(rule, line):
    assert day_line(rule_of(rule)) == line


def test_day_labels_match_the_app():
    assert {k.value: v for k, v in DAY_LABELS.items()} == SHARED_DAY_LABELS


def open_rule(day: str, opens: str = "18:00") -> DayRule:
    return rule_of(
        {
            "day_type": day,
            "opens_at": opens,
            "return_by": "20:00",
            "max_minutes": None,
            "needs_form": False,
            "no_form_from": None,
        }
    )


def test_identical_consecutive_days_share_one_line():
    line = f"6:00 PM{DASH}8:00 PM {DOT} no form needed"
    rules = [open_rule("weekday"), open_rule("saturday"), open_rule("sunday", "10:00")]
    assert labelled_lines(rules) == [
        f"Weekdays and Saturday: {line}",
        f"Sunday: 10:00 AM{DASH}8:00 PM {DOT} no form needed",
    ]
    every = [open_rule(d) for d in ("holiday", "weekday", "sunday", "saturday")]  # any order
    assert labelled_lines(every) == [f"Weekdays, Saturday, Sunday and Holidays: {line}"]
    # Only consecutive days merge: Weekdays and Sunday alike, Saturday between them differs.
    split = [open_rule("weekday"), open_rule("saturday", "10:00"), open_rule("sunday")]
    assert [x.split(":")[0] for x in labelled_lines(split)] == ["Weekdays", "Saturday", "Sunday"]


TUE = date(2026, 11, 24)


def test_the_timings_draft_for_one_rule_set_is_its_lines():
    draft = timings_draft(TUE, [("Hostel A", [open_rule("weekday")])])
    assert draft == Draft(
        title="Outing timings",
        body=(
            f"Outing timings from Tue 24 Nov:\nWeekdays: 6:00 PM{DASH}8:00 PM {DOT} no form needed"
        ),
        too_long=False,
    )


def test_the_timings_draft_for_several_rule_sets_heads_each_block():
    draft = timings_draft(
        TUE, [("Boys 1, Boys 2", [open_rule("weekday")]), ("Girls 1", [open_rule("sunday")])]
    )
    line = f"6:00 PM{DASH}8:00 PM {DOT} no form needed"
    assert draft.body == (
        f"Outing timings from Tue 24 Nov:\n\nBoys 1, Boys 2:\nWeekdays: {line}\n\n"
        f"Girls 1:\nSunday: {line}"
    )
    assert "\n\n\n" not in draft.body


def test_a_draft_over_600_characters_or_20_lines_is_too_long():
    rules = [open_rule("weekday"), open_rule("sunday", "10:00")]
    blocks = [(f"Hostel {n} " + "x" * 50, rules) for n in range(6)]
    draft = timings_draft(TUE, blocks)
    assert len(draft.body) > 600 and draft.too_long
    # 1 + 6 * 4 = 25 lines in 571 characters: short enough, but too many lines.
    many = timings_draft(TUE, [(f"H{n}", rules) for n in range(6)])
    assert len(many.body) <= 600 and many.body.count("\n") + 1 > 20 and many.too_long


def test_the_holiday_draft():
    holiday = rule_of(SHARED_DAY_LINES[0][0] | {"day_type": "holiday"})
    draft = holiday_draft(
        "Diwali", date(2026, 11, 8), [("Boys 1", [open_rule("weekday"), holiday])]
    )
    assert draft == Draft(
        title="Diwali on Sun 8 Nov", body=f"Holiday hours: {SHARED_DAY_LINES[0][1]}", too_long=False
    )
    # A 60-character holiday name makes the title too long to send as drafted.
    assert holiday_draft("D" * 60, date(2026, 11, 8), [("B", [holiday])]).too_long
