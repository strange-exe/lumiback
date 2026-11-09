import assert from "node:assert/strict";
import { test } from "node:test";

import {
  barPercent,
  dayText,
  isEmptyReport,
  minutesText,
  percentText,
  reportBackPath,
  reportExportHref,
  reportMessage,
  resolveReportRange,
  totalLabel,
  weekLabel,
} from "./reports.ts";

const TODAY = "2026-11-09";

test("no dates is the last 30 days, today included", () => {
  assert.deepEqual(resolveReportRange(undefined, undefined, TODAY), {
    from: "2026-10-11",
    to: TODAY,
    problem: null,
  });
  assert.deepEqual(resolveReportRange("", "", TODAY).problem, null);
});

test("a chosen range is kept when it is real, in order and at most a year", () => {
  assert.deepEqual(resolveReportRange("2026-01-01", "2026-01-31", TODAY), {
    from: "2026-01-01",
    to: "2026-01-31",
    problem: null,
  });
  // 366 days counting both ends: the backend's limit.
  assert.equal(resolveReportRange("2025-01-01", "2026-01-01", TODAY).problem, null);
  assert.equal(resolveReportRange("2025-01-01", "2026-01-02", TODAY).problem, "range");
});

test("one end alone, a made-up date or a backwards range is a problem", () => {
  assert.equal(resolveReportRange("2026-01-01", undefined, TODAY).problem, "dates");
  assert.equal(resolveReportRange(undefined, "2026-01-01", TODAY).problem, "dates");
  assert.equal(resolveReportRange("2026-02-30", "2026-03-01", TODAY).problem, "dates");
  assert.equal(resolveReportRange("1999-12-31", "2000-01-01", TODAY).problem, "dates");
  assert.equal(resolveReportRange(["2026-01-01"], "2026-01-02", TODAY).problem, "dates");
  assert.equal(resolveReportRange("2026-03-01", "2026-02-01", TODAY).problem, "order");
});

test("only known problems have a message", () => {
  for (const key of ["dates", "order", "range", "unavailable", "denied", "busy", "failed"]) {
    assert.equal(typeof reportMessage(key), "string", key);
  }
  assert.equal(reportMessage("toString"), null);
  assert.equal(reportMessage("<b>x</b>"), null);
  assert.equal(reportMessage(undefined), null);
});

test("rates, minutes and bars read as words and numbers", () => {
  assert.equal(percentText(2 / 3), "67%");
  assert.equal(percentText(0), "0%");
  assert.equal(percentText(null), "Nobody back");
  assert.equal(minutesText(30), "30 min");
  assert.equal(minutesText(null), "None late");
  assert.equal(barPercent(5, 10), 50);
  assert.equal(barPercent(0, 0), 0);
  assert.equal(barPercent(3, 3), 100);
});

test("days read the same everywhere", () => {
  assert.equal(dayText("2026-09-28"), "28 Sep 2026");
  assert.equal(dayText("2026-11-09"), "9 Nov 2026");
});

test("weeks are named by their Monday, with partial weeks said so", () => {
  assert.equal(
    weekLabel({ week_start: "2026-10-05", days: 7, outings: 0, returned_late: 0 }),
    "Week of 5 Oct",
  );
  assert.equal(
    weekLabel({ week_start: "2026-09-28", days: 4, outings: 0, returned_late: 0 }),
    "Week of 28 Sep (4 days in range)",
  );
  assert.equal(
    weekLabel({ week_start: "2026-11-09", days: 1, outings: 0, returned_late: 0 }),
    "Week of 9 Nov (1 day in range)",
  );
});

test("the download and the way back keep only well formed dates", () => {
  assert.equal(
    reportExportHref("2026-10-01", "2026-10-31"),
    "/admin/reports/export?from=2026-10-01&to=2026-10-31",
  );
  assert.equal(
    reportBackPath("range", "2025-01-01", "javascript:alert(1)"),
    "/admin/reports?export_error=range&from=2025-01-01#report-download",
  );
});

test("a report with nothing in it is empty", () => {
  const zero = {
    outings: 0,
    gate_out: 0,
    self_out: 0,
    back: 0,
    returned_late: 0,
    late_rate: null,
    median_minutes_late: null,
    escalations: 0,
    requests_approved: 0,
    requests_declined: 0,
    running_late: 0,
  };
  const report = {
    start: "2026-10-01",
    end: "2026-10-31",
    every_hostel: true,
    hostels: [],
    total: zero,
    weeks: [],
  };
  assert.equal(isEmptyReport(report), true);
  assert.equal(isEmptyReport({ ...report, total: { ...zero, requests_declined: 1 } }), false);
});

test("the total row says whose hostels it adds up", () => {
  // A warden's total is their hostels, not the campus (the CSV says the same).
  assert.equal(totalLabel({ every_hostel: false }), "Your hostels");
  assert.equal(totalLabel({ every_hostel: true }), "All hostels");
});
