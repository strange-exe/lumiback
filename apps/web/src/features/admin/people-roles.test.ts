import assert from "node:assert/strict";
import { test } from "node:test";

import { listSource, onePage, PEOPLE_PAGE, resultCount, ROLE_CHIPS } from "./people-roles.ts";

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
  // A paged list is never "cut": its next page is a link.
  assert.equal(resultCount(50, null), "50 people shown.");
  assert.equal(resultCount(0, null), "No one shown.");
});

test("one page of the office list, and where the next one starts", () => {
  const people = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}` }));
  assert.equal(PEOPLE_PAGE, 50);
  // One more than a page came back: show a page, the next starts after its last row.
  const full = onePage(people(51));
  assert.equal(full.rows.length, 50);
  assert.equal(full.next, "p50");
  // Exactly a page, or less: nobody follows, so no link to an empty page.
  assert.deepEqual(onePage(people(50)), { rows: people(50), next: null });
  assert.deepEqual(onePage(people(3), 2), { rows: people(2), next: "p2" });
  assert.deepEqual(onePage(people(2), 2), { rows: people(2), next: null });
  assert.deepEqual(onePage([]), { rows: [], next: null });
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
