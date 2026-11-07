import assert from "node:assert/strict";
import { test } from "node:test";

import {
  exportBackPath,
  exportMessage,
  exportProblemFor,
  exportRangeProblem,
  MAX_EXPORT_DAYS,
} from "./export.ts";

test("a valid range within the limit has no problem", () => {
  assert.equal(exportRangeProblem("2026-11-01", "2026-11-07"), null);
  assert.equal(exportRangeProblem("2026-11-07", "2026-11-07"), null);
});

test("the backend's limit: 92 days inclusive passes, 93 is refused", () => {
  assert.equal(MAX_EXPORT_DAYS, 92);
  assert.equal(exportRangeProblem("2026-01-01", "2026-04-02"), null); // 92 days inclusive
  assert.equal(exportRangeProblem("2026-01-01", "2026-04-03"), "range");
  assert.equal(exportRangeProblem("2026-01-01", "2026-06-30"), "range");
});

test("missing, malformed or impossible dates are refused", () => {
  assert.equal(exportRangeProblem("", "2026-11-07"), "dates");
  assert.equal(exportRangeProblem("2026-11-01", null), "dates");
  assert.equal(exportRangeProblem("01/11/2026", "2026-11-07"), "dates");
  assert.equal(exportRangeProblem("2026-02-30", "2026-03-01"), "dates");
});

test("an end before the start is refused", () => {
  assert.equal(exportRangeProblem("2026-11-07", "2026-11-01"), "order");
});

test("backend failures map to a fixed problem", () => {
  assert.equal(exportProblemFor(null), "unavailable");
  assert.equal(exportProblemFor(502), "unavailable");
  assert.equal(exportProblemFor(503), "unavailable");
  assert.equal(exportProblemFor(403), "denied");
  assert.equal(exportProblemFor(404), "denied");
  assert.equal(exportProblemFor(422), "dates");
  assert.equal(exportProblemFor(429), "busy");
  assert.equal(exportProblemFor(400), "failed");
});

test("only known problems have a message; anything else shows nothing", () => {
  for (const key of ["dates", "order", "range", "unavailable", "denied", "busy", "failed"]) {
    assert.equal(typeof exportMessage(key), "string", key);
  }
  assert.equal(exportMessage(undefined), null);
  assert.equal(exportMessage("<img src=x onerror=alert(1)>"), null);
  assert.equal(exportMessage("toString"), null);
});

test("the way back keeps valid dates and drops anything else", () => {
  assert.equal(
    exportBackPath("range", "2026-01-01", "2026-06-30"),
    "/admin?export_error=range&from=2026-01-01&to=2026-06-30#export-heading",
  );
  assert.equal(
    exportBackPath("dates", "javascript:alert(1)", "2026-06-30"),
    "/admin?export_error=dates&to=2026-06-30#export-heading",
  );
});
