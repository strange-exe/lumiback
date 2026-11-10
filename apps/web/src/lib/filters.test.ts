import assert from "node:assert/strict";
import { test } from "node:test";

import {
  chosenFrom,
  extrasFrom,
  FILTERS_COOKIE,
  FILTERS_MAX_AGE,
  filterHref,
  filterView,
  isExplicit,
  pageHref,
  parseFilters,
  remember,
  resolveFilters,
  serializeFilters,
} from "./filters.ts";

const HOSTEL = "5f0c2a1e-0000-4000-8000-000000000001";
const GATE = "7a1b2c3d-0000-4000-8000-0000000000aa";

const params = (query: string) => Object.fromEntries(new URLSearchParams(query));

test("the cookie has its own name and lasts a term", () => {
  assert.equal(FILTERS_COOKIE, "lb_office_filters");
  assert.equal(FILTERS_MAX_AGE, 90 * 24 * 60 * 60);
});

test("a well-formed cookie is read back exactly", () => {
  const raw = JSON.stringify({
    register: { state: "overdue" },
    people: { hostel: HOSTEL, account: "off" },
    scans: { gate: GATE, result: "too_far" },
    escalations: { state: "all" },
  });
  assert.deepEqual(parseFilters(raw), {
    register: { state: "overdue" },
    people: { hostel: HOSTEL, account: "off" },
    scans: { gate: GATE, result: "too_far" },
    escalations: { state: "all" },
  });
});

test("anything outside the allowlist is dropped, the rest kept", () => {
  const raw = JSON.stringify({
    register: { state: "everyone", extra: "x" }, // not a state
    people: { hostel: "../admin/users", account: "invited", q: "kabir" }, // not a UUID; q isn't kept
    scans: { gate: GATE.toUpperCase().replace(/-/g, ""), result: "<script>" },
    escalations: { state: ["all"] },
    requests: { day: "2026-11-01" }, // not a remembered page
  });
  const polluting = `{"__proto__":{"polluted":true},${raw.slice(1)}`;
  assert.deepEqual(parseFilters(polluting), { people: { account: "invited" } });
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("garbage, oversize and non-objects are ignored", () => {
  for (const raw of [
    undefined,
    "",
    "not json",
    "[]",
    "null",
    "42",
    '"people"',
    JSON.stringify({ people: "off" }),
    JSON.stringify({ people: { account: "off" }, pad: "x".repeat(2000) }),
  ]) {
    assert.deepEqual(parseFilters(raw), {}, String(raw).slice(0, 40));
  }
});

test("a choice keeps only valid, non-default values", () => {
  assert.deepEqual(chosenFrom("people", params(`hostel=${HOSTEL}&account=off&q=kabir`)), {
    hostel: HOSTEL,
    account: "off",
  });
  // "All" is the reset: nothing to remember.
  assert.deepEqual(chosenFrom("people", params("hostel=all&account=all")), {});
  assert.deepEqual(chosenFrom("register", params("state=all")), {});
  assert.deepEqual(chosenFrom("register", params("state=out")), { state: "out" });
  assert.deepEqual(chosenFrom("escalations", params("state=open")), {});
  assert.deepEqual(chosenFrom("escalations", params("state=all")), { state: "all" });
  assert.deepEqual(chosenFrom("scans", params("gate=&result=")), {});
  assert.deepEqual(chosenFrom("scans", params(`gate=${GATE}&result=mock_gps`)), {
    gate: GATE,
    result: "mock_gps",
  });
  assert.deepEqual(chosenFrom("scans", params("gate=nope&result=deleted")), {});
});

test("remembering one page leaves the others, and an empty choice removes it", () => {
  let kept = remember({}, "register", { state: "overdue" });
  kept = remember(kept, "people", { account: "off" });
  assert.deepEqual(kept, { register: { state: "overdue" }, people: { account: "off" } });
  kept = remember(kept, "register", {});
  assert.deepEqual(kept, { people: { account: "off" } });
  assert.deepEqual(parseFilters(serializeFilters(kept)), kept);
});

test("the cookie stays short with every page remembered", () => {
  const all = {
    register: { state: "overdue", hostel: HOSTEL },
    people: { hostel: HOSTEL, account: "invited" },
    scans: { gate: GATE, result: "not_allowed" },
    escalations: { state: "all" },
    audit: { area: "correction" },
  } as const;
  assert.ok(serializeFilters(all).length < 400);
  assert.deepEqual(parseFilters(serializeFilters(all)), all);
});

test("a visit with any filter, search or page in its address is explicit", () => {
  assert.equal(isExplicit("people", params("")), false);
  assert.equal(isExplicit("people", params("cancelled=1")), false);
  assert.equal(isExplicit("people", params("q=kabir")), true);
  assert.equal(isExplicit("people", params("account=all")), true);
  assert.equal(isExplicit("register", params("export_error=range")), false);
  assert.equal(isExplicit("register", params("state=all")), true);
  assert.equal(isExplicit("scans", params("before=120")), true);
  // A later page of People shows exactly the filters in its address.
  assert.equal(isExplicit("people", params("after=7a1b2c3d-0000-4000-8000-0000000000bb")), true);
  assert.equal(isExplicit("escalations", params("state=open")), true);
});

test("the address wins; a bare visit uses what was remembered", () => {
  const kept = { people: { hostel: HOSTEL, account: "off" } } as const;
  assert.deepEqual(resolveFilters("people", params(""), kept), {
    values: { hostel: HOSTEL, account: "off" },
    remembered: true,
  });
  assert.deepEqual(resolveFilters("people", params("account=invited"), kept), {
    values: { account: "invited" },
    remembered: false,
  });
  // An explicit "all" shows all, whatever was remembered.
  assert.deepEqual(resolveFilters("people", params("account=all"), kept), {
    values: {},
    remembered: false,
  });
  assert.deepEqual(resolveFilters("register", params(""), kept), {
    values: {},
    remembered: false,
  });
});

test("filter links go through the remembering route, built from fixed parts", () => {
  assert.equal(
    filterHref("register", { state: "overdue" }),
    "/admin/filter?view=register&state=overdue",
  );
  assert.equal(filterHref("register", {}), "/admin/filter?view=register");
  assert.equal(
    filterHref("people", { hostel: HOSTEL, account: "off" }, { q: "a&b=c" }),
    `/admin/filter?view=people&hostel=${HOSTEL}&account=off&q=a%26b%3Dc`,
  );
});

test("the page address holds every non-default value, or none", () => {
  assert.equal(pageHref("register", {}), "/admin");
  assert.equal(pageHref("register", { state: "out" }), "/admin?state=out");
  assert.equal(pageHref("people", {}, { q: "kabir" }), "/admin/people?q=kabir");
  assert.equal(
    pageHref("scans", { gate: GATE, result: "accepted" }),
    `/admin/scans?gate=${GATE}&result=accepted`,
  );
  assert.equal(pageHref("escalations", { state: "all" }), "/admin/escalations?state=all");
  // A search longer than the page accepts is cut, never passed on whole.
  assert.equal(
    pageHref("people", {}, { q: "x".repeat(150) }),
    `/admin/people?q=${"x".repeat(100)}`,
  );
});

test("the register remembers a hostel and carries a search it doesn't remember", () => {
  assert.deepEqual(chosenFrom("register", params(`state=out&hostel=${HOSTEL}&q=riya`)), {
    state: "out",
    hostel: HOSTEL,
  });
  assert.deepEqual(extrasFrom("register", params(`q=%20riya%20&from=2026-11-01`)), { q: "riya" });
  assert.equal(
    pageHref("register", { hostel: HOSTEL.toUpperCase() }, { q: "Riya Sen" }),
    `/admin?hostel=${HOSTEL}&q=Riya+Sen`,
  );
  // The API refuses one-letter searches, so a link never carries one.
  assert.equal(pageHref("register", {}, { q: "r" }), "/admin");
  assert.equal(isExplicit("register", params("q=ri")), true);
  assert.deepEqual(parseFilters(JSON.stringify({ register: { hostel: HOSTEL, q: "riya" } })), {
    register: { hostel: HOSTEL },
  });
});

test("scans carry a search and real dates only", () => {
  assert.deepEqual(
    extrasFrom("scans", params("q=22CS001&from=2026-11-01&to=2026-11-07&before=9&gate=x")),
    { q: "22CS001", from: "2026-11-01", to: "2026-11-07" },
  );
  // 1999 and 3000 are real dates but outside what the API takes (it would answer 422).
  const bads = ["2026-02-30", "2026-13-01", "01-11-2026", "2026-11-1", "today", ""];
  for (const bad of [...bads, "1999-12-31", "3000-01-01"]) {
    assert.deepEqual(extrasFrom("scans", { from: bad, to: bad }), {}, bad);
  }
  assert.deepEqual(chosenFrom("scans", params("result=not_allowed")), { result: "not_allowed" });
  assert.equal(
    filterHref("scans", { result: "too_far" }, { q: "kabir", from: "2026-11-01" }),
    "/admin/filter?view=scans&result=too_far&q=kabir&from=2026-11-01",
  );
  assert.equal(isExplicit("scans", params("to=2026-11-07")), true);
});

test("scans remember a hostel too (wave 5)", () => {
  assert.deepEqual(chosenFrom("scans", params(`hostel=${HOSTEL}&gate=${GATE}`)), {
    gate: GATE,
    hostel: HOSTEL,
  });
  assert.deepEqual(chosenFrom("scans", params("hostel=all")), {});
  assert.deepEqual(chosenFrom("scans", params("hostel=../x")), {});
  assert.equal(
    pageHref("scans", { hostel: HOSTEL.toUpperCase(), result: "accepted" }),
    `/admin/scans?result=accepted&hostel=${HOSTEL}`,
  );
  assert.deepEqual(parseFilters(JSON.stringify({ scans: { hostel: HOSTEL } })), {
    scans: { hostel: HOSTEL },
  });
});

test("people carry a role chip in the address, never remembered (wave 5)", () => {
  assert.deepEqual(extrasFrom("people", params("role=head_warden&q=ri")), {
    q: "ri",
    role: "head_warden",
  });
  for (const bad of ["all", "superuser", "Student", ""]) {
    assert.deepEqual(extrasFrom("people", { role: bad }), {}, bad);
  }
  assert.deepEqual(chosenFrom("people", params("role=warden")), {});
  assert.equal(isExplicit("people", params("role=warden")), true);
  assert.equal(
    filterHref("people", { account: "off" }, { q: "kabir", role: "student" }),
    "/admin/filter?view=people&account=off&q=kabir&role=student",
  );
  assert.deepEqual(parseFilters(JSON.stringify({ people: { role: "admin" } })), {});
});

test("the audit log remembers an area from the fixed list", () => {
  assert.equal(filterView("audit"), "audit");
  assert.equal(filterView("__proto__"), null);
  assert.equal(filterView("toString"), null);
  assert.deepEqual(chosenFrom("audit", params("area=people")), { area: "people" });
  assert.deepEqual(chosenFrom("audit", params("area=people:add")), {});
  assert.deepEqual(chosenFrom("audit", params("area=all")), {});
  assert.equal(
    pageHref("audit", { area: "settings" }, { q: "asha", from: "2026-11-01", to: "2026-11-02" }),
    "/admin/audit?area=settings&q=asha&from=2026-11-01&to=2026-11-02",
  );
  assert.equal(isExplicit("audit", params("before=40")), true);
  assert.deepEqual(parseFilters(JSON.stringify({ audit: { area: "rules", from: "2026-11-01" } })), {
    audit: { area: "rules" },
  });
});
