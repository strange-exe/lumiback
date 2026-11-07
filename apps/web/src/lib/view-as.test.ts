import assert from "node:assert/strict";
import { test } from "node:test";

import { cookieBase } from "./cookies.ts";
import {
  canViewAs,
  DEVELOPERS_ONLY,
  endsViewAs,
  endTarget,
  homeFor,
  READ_ONLY,
  UNKNOWN_ROLE,
  VIEW_AS_COOKIE,
  VIEW_AS_HEADER,
  VIEW_CHOICES,
  viewAsHeaders,
  viewChoice,
  viewingAsOf,
  viewRole,
} from "./view-as.ts";

const TOKEN = "access-token";

test("the cookie and header have the contract's names", () => {
  assert.equal(VIEW_AS_COOKIE, "lb_view_as_role");
  assert.equal(VIEW_AS_HEADER, "X-View-As-Role");
});

test("each of the four roles in the cookie is read as itself", () => {
  for (const role of ["admin", "head_warden", "warden", "student"] as const) {
    assert.equal(viewRole(role), role);
  }
});

test("anything else in the cookie is ignored, never sent", () => {
  for (const bad of [
    "developer", // yourself: that's no cookie at all
    "Student",
    "STUDENT",
    " student",
    "student ",
    "student\r\nX-Other: 1",
    "head-warden",
    "5f0c2a1e-0000-4000-8000-000000000001", // the old per-account cookie's value
    "",
    null,
    undefined,
  ]) {
    assert.equal(viewRole(bad), null, String(bad));
    assert.deepEqual(viewAsHeaders({ token: TOKEN, cookie: bad }), {}, String(bad));
  }
});

test("calls made as the signed-in person carry the header while the cookie holds a role", () => {
  assert.deepEqual(viewAsHeaders({ token: TOKEN, cookie: "warden" }), {
    [VIEW_AS_HEADER]: "warden",
  });
  assert.deepEqual(viewAsHeaders({ token: TOKEN, cookie: "student" }), {
    [VIEW_AS_HEADER]: "student",
  });
});

test("calls without a token (guests, kiosks, sign-in) never carry it", () => {
  assert.deepEqual(viewAsHeaders({ token: null, cookie: "student" }), {});
  assert.deepEqual(viewAsHeaders({ token: undefined, cookie: "admin" }), {});
  assert.deepEqual(viewAsHeaders({ token: "", cookie: "admin" }), {});
});

test("acting as yourself (asking who you really are) leaves it off", () => {
  assert.deepEqual(viewAsHeaders({ token: TOKEN, cookie: "student", asSelf: true }), {});
});

test("the menu's five choices, in order, and nothing else is accepted from a form", () => {
  assert.deepEqual(VIEW_CHOICES, ["developer", "admin", "head_warden", "warden", "student"]);
  for (const choice of VIEW_CHOICES) assert.equal(viewChoice(choice), choice);
  for (const bad of ["Developer", "root", "", null, undefined, 1, ["student"], { role: "admin" }]) {
    assert.equal(viewChoice(bad), null, JSON.stringify(bad));
  }
});

test("a student view lands on Today; every other choice, Developer included, on the office", () => {
  assert.equal(homeFor("student"), "/home");
  for (const choice of ["developer", "admin", "head_warden", "warden"] as const) {
    assert.equal(homeFor(choice), "/admin", choice);
  }
});

test("/auth/me's viewing_as is read only when it's one of the four roles", () => {
  assert.equal(viewingAsOf({ viewing_as: "warden" }), "warden");
  assert.equal(viewingAsOf({ viewing_as: null }), null);
  assert.equal(viewingAsOf({}), null); // an API that predates the field
  assert.equal(viewingAsOf({ viewing_as: "developer" }), null);
  assert.equal(viewingAsOf({ viewing_as: 3 }), null);
});

test("only a developer, or one viewing now, gets the View as menu", () => {
  assert.equal(canViewAs("developer", null), true);
  assert.equal(canViewAs("student", "student"), true); // a developer viewing as a student
  assert.equal(canViewAs("warden", "warden"), true);
  for (const role of ["admin", "head_warden", "warden", "student"] as const) {
    assert.equal(canViewAs(role, null), false, role);
  }
});

test("'developers only' (403) and 'unknown role' (400) end the view; other errors don't", () => {
  assert.equal(endsViewAs(403, DEVELOPERS_ONLY), true);
  assert.equal(endsViewAs(400, UNKNOWN_ROLE), true);
  // A refused change while viewing keeps the view: the form says why instead.
  assert.equal(endsViewAs(403, READ_ONLY), false);
  assert.equal(endsViewAs(403, "Not allowed"), false);
  assert.equal(endsViewAs(400, DEVELOPERS_ONLY), false);
  assert.equal(endsViewAs(403, UNKNOWN_ROLE), false);
  assert.equal(endsViewAs(401, DEVELOPERS_ONLY), false);
  assert.equal(endsViewAs(503, UNKNOWN_ROLE), false);
  assert.equal(endsViewAs(400, "Unknown role to view as."), false); // compared exactly
});

test("clearing a stale view only goes to a fixed list of pages", () => {
  assert.equal(endTarget("/admin"), "/admin");
  assert.equal(endTarget("/home"), "/home");
  for (const bad of [
    "https://evil.example",
    "//evil.example",
    "/admin/../x",
    "/admin/developer",
    null,
    undefined,
    "",
  ]) {
    assert.equal(endTarget(bad), "/home", String(bad));
  }
});

test("the view-as cookie uses the shared cookie options: httpOnly, Lax, site-wide", () => {
  const base = cookieBase("production");
  assert.equal(base.httpOnly, true);
  assert.equal(base.sameSite, "lax");
  assert.equal(base.path, "/");
  assert.equal(base.secure, true);
});
