import assert from "node:assert/strict";
import { test } from "node:test";

import type { Correction } from "../../lib/types.ts";
import { correctionText, recordHref, recordId, recordView } from "./record.ts";

const LEFT = "2026-11-01T18:00:00+05:30";
const base: Correction = {
  id: "c1",
  kind: "return_time",
  status: "approved",
  returned_at: "2026-11-01T20:40:00+05:30",
  reason: "Scanned in late",
  by_staff: false,
  old_returned_at: "2026-11-01T22:05:00+05:30",
  note: null,
  created_at: "2026-11-02T09:00:00+05:30",
};

test("corrections read in the office's words", () => {
  assert.deepEqual(correctionText(base, LEFT), {
    title: "Student asked: came back at 8:40 PM",
    status: "Applied",
    details: ["Reason: Scanned in late", "Was back at 10:05 PM"],
  });
  assert.deepEqual(
    correctionText(
      { ...base, kind: "cancel", returned_at: null, by_staff: true, old_returned_at: null },
      LEFT,
    ),
    {
      title: "The office recorded: this trip didn't happen",
      status: "Applied",
      details: ["Reason: Scanned in late"],
    },
  );
  const declined = correctionText(
    { ...base, status: "declined", note: "Gate log disagrees" },
    LEFT,
  );
  assert.equal(declined.status, "Declined");
  assert.deepEqual(declined.details.at(-1), "Office note: Gate log disagrees");
  assert.equal(
    correctionText({ ...base, status: "pending" }, LEFT).status,
    "Waiting for a decision",
  );
});

const ID = "5f0c2a1e-0000-4000-8000-000000000001";

test("record links name the tab and page only when needed", () => {
  assert.equal(recordHref(ID), `/admin/people/${ID}`);
  assert.equal(recordHref(ID, "requests"), `/admin/people/${ID}?show=requests`);
  assert.equal(recordHref(ID, "scans", "120"), `/admin/people/${ID}?show=scans&before=120`);
  assert.equal(
    recordHref(ID, "outings", "2026-11-01T20:15:00+05:30"),
    `/admin/people/${ID}?before=2026-11-01T20%3A15%3A00%2B05%3A30`,
  );
});

test("the address gives a known tab and a cursor that fits it", () => {
  assert.deepEqual(recordView({}), { tab: "outings", before: undefined });
  assert.deepEqual(recordView({ show: "requests", before: "2026-11-01T20:15:00.123+05:30" }), {
    tab: "requests",
    before: "2026-11-01T20:15:00.123+05:30",
  });
  assert.deepEqual(recordView({ show: "scans", before: "120" }), { tab: "scans", before: "120" });
  // A cursor of the wrong kind, or anything malformed, is the newest page.
  assert.deepEqual(recordView({ show: "scans", before: "2026-11-01T20:15:00+05:30" }), {
    tab: "scans",
    before: undefined,
  });
  for (const before of ["0", "-1", "12abc", "2026-13-45T99:99:99+05:30", "today", ["120"]]) {
    assert.equal(recordView({ before }).before, undefined, String(before));
    assert.equal(recordView({ show: "scans", before }).before, undefined, String(before));
  }
  for (const show of ["escalations", "__proto__", "", ["scans"]]) {
    assert.equal(recordView({ show }).tab, "outings", String(show));
  }
});

test("only a UUID is a record id", () => {
  assert.equal(recordId(ID.toUpperCase()), ID);
  for (const bad of ["", "me", "../admin", `${ID}x`, 5, null]) {
    assert.equal(recordId(bad), null, String(bad));
  }
});
