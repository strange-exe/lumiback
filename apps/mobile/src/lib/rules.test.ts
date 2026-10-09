import { formNeededAt, plannedReturn, rulesLine } from "./rules";
import type { TodayRules } from "./types";

const at = (hhmm: string) => `2026-10-08T${hhmm}:00+05:30`;
const ms = (hhmm: string) => Date.parse(at(hhmm));

const weekday: TodayRules = {
  day: "2026-10-08",
  day_type: "weekday",
  label: "Weekday",
  rule_set: "Boys' hostels",
  hostel: "Hostel 3",
  opens_at: at("18:00"),
  return_by: at("20:00"),
  max_minutes: null,
  needs_form: false,
};

const sunday: TodayRules = {
  ...weekday,
  day_type: "sunday",
  label: "Sunday",
  opens_at: at("10:00"),
  max_minutes: 300,
  needs_form: true,
};

test("before the window: when it opens", () => {
  expect(rulesLine(weekday, ms("16:30"))).toEqual({
    title: "Weekday outings 6:00 PM–8:00 PM",
    detail: "Opens in 1 h 30 min",
    urgent: false,
    open: false,
  });
});

test("during the window: back-by time and time left", () => {
  expect(rulesLine(weekday, ms("18:10"))).toEqual({
    title: "Back by 8:00 PM",
    detail: "Outings close in 1 h 50 min",
    urgent: false,
    open: true,
  });
  expect(rulesLine(weekday, ms("19:30")).urgent).toBe(true);
});

test("after the window", () => {
  expect(rulesLine(weekday, ms("20:00"))).toMatchObject({
    title: "Outings are over for today",
    detail: "Weekday hours: 6:00 PM–8:00 PM",
    open: false,
  });
});

test("form days say so, with their limit", () => {
  expect(rulesLine(sunday, ms("11:00"))).toMatchObject({
    title: "Up to 5 h, back by 8:00 PM",
    detail: "Outings close in 9 h · Needs an approved form",
  });
});

test("boys' Sunday: a form in the day, none from 6 PM", () => {
  const boys: TodayRules = { ...sunday, max_minutes: 180, no_form_from: at("18:00") };
  expect(formNeededAt(boys, ms("17:59"))).toBe(true);
  expect(formNeededAt(boys, ms("18:00"))).toBe(false);
  expect(formNeededAt(sunday, ms("19:00"))).toBe(true);
  expect(rulesLine(boys, ms("11:00"))).toMatchObject({
    title: "Up to 3 h, back by 8:00 PM",
    detail: "Outings close in 9 h · Needs an approved form until 6:00 PM",
  });
  expect(rulesLine(boys, ms("18:30"))).toMatchObject({
    title: "Back by 8:00 PM",
    detail: "Outings close in 1 h 30 min · No form needed now",
  });
  // The evening has no maximum, like a weekday.
  expect(plannedReturn(boys, ms("11:00")).getTime()).toBe(ms("14:00"));
  expect(plannedReturn(boys, ms("18:00")).getTime()).toBe(ms("20:00"));
});

test("planned return matches the server's rule", () => {
  expect(plannedReturn(weekday, ms("18:30")).toISOString()).toBe(
    new Date(at("20:00")).toISOString(),
  );
  expect(plannedReturn(sunday, ms("11:00")).getTime()).toBe(ms("16:00"));
  expect(plannedReturn(sunday, ms("17:00")).getTime()).toBe(ms("20:00")); // never past back-by
  expect(plannedReturn(sunday, ms("11:00"), { requestedMinutes: 120 }).getTime()).toBe(ms("13:00"));
});
