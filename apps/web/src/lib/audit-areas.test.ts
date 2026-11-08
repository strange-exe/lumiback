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

test("alerts' actions read in plain words", () => {
  assert.equal(actionLabel("help:handle"), "Help requests: handle");
  assert.equal(actionLabel("notice:send"), "Notices: send");
  assert.equal(actionLabel("notice:recall"), "Notices: recall");
  assert.equal(actionLabel("escalation:claim"), "Late follow-ups: claim");
  assert.equal(actionLabel("escalation:call"), "Late follow-ups: call");
});

test("update announcements have their own area", () => {
  assert.equal(isAuditArea("announce"), true);
  assert.equal(actionLabel("announce:update"), "Announcements: update");
});
