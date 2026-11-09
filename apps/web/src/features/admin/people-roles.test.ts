import assert from "node:assert/strict";
import { test } from "node:test";

import { listSource, resultCount, ROLE_CHIPS } from "./people-roles.ts";

test("the role chips, in order, with All first", () => {
  assert.deepEqual(
    ROLE_CHIPS.map((c) => [c.value ?? null, c.label]),
    [
      [null, "All"],
      ["student", "Students"],
      ["warden", "Wardens"],
      ["head_warden", "Head wardens"],
      ["admin", "Admins"],
      ["developer", "Developers"],
    ],
  );
});

test("how many are shown, and when the list is cut", () => {
  assert.equal(resultCount(0, 50), "No one shown.");
  assert.equal(resultCount(1, 50), "1 person shown.");
  assert.equal(resultCount(12, 50), "12 people shown.");
  assert.equal(resultCount(50, 50), "The first 50 shown. Search to narrow it down.");
  assert.equal(resultCount(300, 300), "The first 300 shown. Search to narrow it down.");
});

test("which list answers: a staff role chip uses the admins' search, the rest the office list", () => {
  const base = { isAdmin: true, search: undefined, account: undefined, hostel: undefined };
  assert.equal(listSource({ ...base, role: undefined }), "students");
  assert.equal(listSource({ ...base, search: "ri", role: undefined }), "search");
  assert.equal(listSource({ ...base, role: "warden" }), "search");
  assert.equal(listSource({ ...base, role: "developer", search: "ri" }), "search");
  // Students have phone numbers and hostels in the office list.
  assert.equal(listSource({ ...base, role: "student" }), "students");
  assert.equal(listSource({ ...base, role: "warden", account: "off" }), "students");
  assert.equal(listSource({ ...base, role: "admin", hostel: "h" }), "students");
  // Wardens never search everyone, whatever the address says.
  assert.equal(listSource({ ...base, isAdmin: false, role: "warden", search: "ri" }), "students");
});
