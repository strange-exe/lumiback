import {
  canAskAt,
  formNeededAt,
  freeEveningAhead,
  lengthOptions,
  plannedReturn,
  rulesLine,
} from "./rules";
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
    closed: "before",
  });
});

test("during the window: back-by time and time left", () => {
  expect(rulesLine(weekday, ms("18:10"))).toEqual({
    title: "Back by 8:00 PM",
    detail: "Outings close in 1 h 50 min",
    urgent: false,
    open: true,
  });
  expect(rulesLine(weekday, ms("18:10")).closed).toBeUndefined();
  expect(rulesLine(weekday, ms("19:30")).urgent).toBe(true);
});

test("after the window", () => {
  expect(rulesLine(weekday, ms("20:00"))).toMatchObject({
    title: "Outings are over for today",
    detail: "Weekday hours: 6:00 PM–8:00 PM",
    open: false,
    closed: "after",
  });
});

test("asking for the outing works before opening, not in a no-form evening or after", () => {
  const boys: TodayRules = { ...sunday, max_minutes: 180, no_form_from: at("18:00") };
  expect(canAskAt(sunday, ms("08:00"))).toBe(true); // before 10 AM opening
  expect(canAskAt(sunday, ms("19:59"))).toBe(true);
  expect(canAskAt(sunday, ms("20:00"))).toBe(false);
  expect(canAskAt(boys, ms("17:59"))).toBe(true);
  expect(canAskAt(boys, ms("18:00"))).toBe(false);
  expect(canAskAt(weekday, ms("17:00"))).toBe(false);
});

test("the no-form evening still ahead", () => {
  const boys: TodayRules = { ...sunday, max_minutes: 180, no_form_from: at("18:00") };
  expect(freeEveningAhead(boys, ms("12:00"))).toBe(at("18:00"));
  expect(freeEveningAhead(boys, ms("18:00"))).toBeNull();
  expect(freeEveningAhead(sunday, ms("12:00"))).toBeNull();
  expect(freeEveningAhead(weekday, ms("12:00"))).toBeNull();
});

describe("lengthOptions", () => {
  const labels = (rules: TodayRules, now: number) =>
    lengthOptions(rules, now).map((o) => [o.minutes, o.label]);

  it("offers every whole hour below the maximum, the maximum first", () => {
    expect(labels(sunday, ms("10:00"))).toEqual([
      [null, "Up to 5 h"],
      [60, "1 h"],
      [120, "2 h"],
      [180, "3 h"],
      [240, "4 h"],
    ]);
    const boys: TodayRules = { ...sunday, max_minutes: 180 };
    expect(labels(boys, ms("10:00"))).toEqual([
      [null, "Up to 3 h"],
      [60, "1 h"],
      [120, "2 h"],
    ]);
  });

  it("counts from opening time when asking early", () => {
    expect(lengthOptions(sunday, ms("07:00"))).toHaveLength(5);
  });

  it("never offers more hours than are left before the return time", () => {
    expect(labels(sunday, ms("17:30"))).toEqual([
      [null, "Up to 5 h"],
      [60, "1 h"],
      [120, "2 h"],
    ]);
    expect(labels(sunday, ms("19:30"))).toEqual([[null, "Up to 5 h"]]);
  });

  it("without a maximum, offers the hours up to the time left", () => {
    const open: TodayRules = { ...sunday, max_minutes: null };
    expect(labels(open, ms("17:00"))).toEqual([
      [null, "Until 8:00 PM"],
      [60, "1 h"],
      [120, "2 h"],
    ]);
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
  // A shorter length asked for still applies on a day with no maximum.
  const noMax: TodayRules = { ...sunday, max_minutes: null };
  expect(plannedReturn(noMax, ms("11:00"), { requestedMinutes: 60 }).getTime()).toBe(ms("12:00"));
  expect(plannedReturn(noMax, ms("11:00")).getTime()).toBe(ms("20:00"));
});
