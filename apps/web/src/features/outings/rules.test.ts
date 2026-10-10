import assert from "node:assert/strict";
import { test } from "node:test";

import type { TodayRules } from "../../lib/types.ts";
import { approvedDue, closedAt, lengthOptions } from "./rules.ts";

const at = (hhmm: string): string => `2026-10-11T${hhmm}:00+05:30`;
const ms = (hhmm: string): number => Date.parse(at(hhmm));

const sunday = (max: number | null): TodayRules => ({
  day: "2026-10-11",
  day_type: "sunday",
  label: "Sunday",
  rule_set: "Girls",
  hostel: null,
  opens_at: at("10:00"),
  return_by: at("20:00"),
  max_minutes: max,
  needs_form: true,
  no_form_from: null,
});

test("every whole hour below the maximum, after the full allowance", () => {
  const options = lengthOptions(sunday(300), ms("09:00"));
  assert.deepEqual(
    options.map((o) => o.minutes),
    [null, 60, 120, 180, 240],
  );
  assert.equal(options[0].label, "Up to 5 h");
});

test("the time left caps the choices", () => {
  assert.deepEqual(
    lengthOptions(sunday(300), ms("17:30")).map((o) => o.minutes),
    [null, 60, 120],
  );
});

test("without a maximum: until the return time, then the whole hours left", () => {
  const options = lengthOptions(sunday(null), ms("16:15"));
  assert.deepEqual(
    options.map((o) => o.minutes),
    [null, 60, 120, 180],
  );
  assert.match(options[0].label, /^Until 8:00/);
});

test("open, not yet open, or over for today", () => {
  assert.equal(closedAt(sunday(300), ms("09:59")), "before");
  assert.equal(closedAt(sunday(300), ms("10:00")), null);
  assert.equal(closedAt(sunday(300), ms("20:00")), "after");
});

test("the approved due time is the shorter of the maximum and the request", () => {
  assert.match(approvedDue(sunday(300), 120), /^2 h after you leave, by 8:00/);
  assert.match(approvedDue(sunday(300), null), /^5 h after you leave/);
  assert.match(approvedDue(sunday(null), null), /^by 8:00/);
  assert.match(approvedDue(sunday(null), 60), /^1 h after you leave/);
});
