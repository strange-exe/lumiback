import assert from "node:assert/strict";
import { test } from "node:test";

import { actionLabel, AUDIT_AREA_LABELS, AUDIT_AREAS, isAuditArea } from "./audit-areas.ts";

test("every area has a label", () => {
  for (const area of AUDIT_AREAS) assert.ok(AUDIT_AREA_LABELS[area], area);
  assert.equal(Object.keys(AUDIT_AREA_LABELS).length, AUDIT_AREAS.length);
});

test("only the fixed areas are areas", () => {
  assert.equal(isAuditArea("people"), true);
  for (const bad of ["people:add", "toString", "__proto__", "", 3, null]) {
    assert.equal(isAuditArea(bad), false, String(bad));
  }
});

test("actions read as area and verb", () => {
  assert.equal(actionLabel("people:add"), "People: add");
  assert.equal(actionLabel("rules:default"), "Outing rules: default");
  assert.equal(actionLabel("settings"), "Settings");
  assert.equal(actionLabel("account:password_reset"), "Accounts: password reset");
  assert.equal(actionLabel("mystery:thing"), "mystery: thing");
});
