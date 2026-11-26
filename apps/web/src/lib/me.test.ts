import assert from "node:assert/strict";
import { test } from "node:test";

import { ApiError } from "./api-error.ts";
import { whoIsSignedIn, type AskMe } from "./me.ts";
import type { User } from "./types.ts";
import { DEVELOPERS_ONLY, READ_ONLY, UNKNOWN_ROLE } from "./view-as.ts";

const person = (over: Partial<User> = {}): User => ({
  id: "u1",
  name: "Tarun Bisht",
  email: "e2e-dev@geu.ac.in",
  roll_no: null,
  hostel: null,
  email_verified: true,
  created_at: "2026-11-01T00:00:00Z",
  role: "developer",
  viewing_as: null,
  ...over,
});

/** A fake /auth/me: answers in turn, and records whether each call was made as self. */
function fake(...answers: (User | ApiError | Error)[]): AskMe & { calls: boolean[] } {
  const calls: boolean[] = [];
  const ask = async (asSelf: boolean): Promise<User> => {
    calls.push(asSelf);
    const next = answers.shift();
    if (next === undefined) throw new Error("unexpected extra call");
    if (next instanceof Error) throw next;
    return next;
  };
  return Object.assign(ask, { calls });
}

test("no view: the person, asked once with the view header allowed, not stale", async () => {
  const ask = fake(person({ role: "student", viewing_as: null }));
  const found = await whoIsSignedIn(ask, null);
  assert.deepEqual(found, { user: person({ role: "student", viewing_as: null }), stale: false });
  assert.deepEqual(ask.calls, [false]);
});

test("a view the API honours: the viewed role, not stale", async () => {
  const viewed = person({ role: "warden", viewing_as: "warden" });
  const ask = fake(viewed);
  assert.deepEqual(await whoIsSignedIn(ask, "warden"), { user: viewed, stale: false });
  assert.deepEqual(ask.calls, [false]);
});

test("a view the API ignored (no viewing_as back) is stale, so the cookie gets cleared", async () => {
  const ask = fake(person({ role: "admin", viewing_as: null }));
  const found = await whoIsSignedIn(ask, "student");
  assert.equal(found?.stale, true);
  assert.equal(found?.user.role, "admin");
});

test("a view answered as a different role is stale too", async () => {
  const ask = fake(person({ role: "warden", viewing_as: "warden" }));
  assert.equal((await whoIsSignedIn(ask, "student"))?.stale, true);
});

for (const [status, detail] of [
  [403, DEVELOPERS_ONLY],
  [400, UNKNOWN_ROLE],
] as const) {
  test(`a view the API refuses (${status}) asks again as self: still signed in, stale`, async () => {
    const self = person({ role: "admin" });
    const ask = fake(new ApiError(status, detail), self);
    const found = await whoIsSignedIn(ask, "student");
    assert.deepEqual(found, { user: { ...self, viewing_as: null }, stale: true });
    assert.deepEqual(ask.calls, [false, true]);
  });
}

test("a refused view whose second ask fails too is signed out (null), never a throw", async () => {
  const ask = fake(new ApiError(403, DEVELOPERS_ONLY), new ApiError(401, "Not signed in"));
  assert.equal(await whoIsSignedIn(ask, "student"), null);
  const down = fake(new ApiError(403, DEVELOPERS_ONLY), new ApiError(503, "Unavailable"));
  assert.equal(await whoIsSignedIn(down, "warden"), null);
});

test("a refusal without a view is not retried as self", async () => {
  const ask = fake(new ApiError(403, DEVELOPERS_ONLY));
  assert.equal(await whoIsSignedIn(ask, null), null);
  assert.deepEqual(ask.calls, [false]);
});

test("401 and 403 mean signed out (null)", async () => {
  assert.equal(await whoIsSignedIn(fake(new ApiError(401, "Expired")), null), null);
  assert.equal(await whoIsSignedIn(fake(new ApiError(403, "Turned off")), null), null);
  // A read-only refusal is a 403 but not one that ends the view: signed out, not retried.
  const ask = fake(new ApiError(403, READ_ONLY));
  assert.equal(await whoIsSignedIn(ask, "warden"), null);
  assert.deepEqual(ask.calls, [false]);
});

test("any other failure is thrown, not taken for signed out", async () => {
  await assert.rejects(whoIsSignedIn(fake(new ApiError(503, "Unavailable")), null), {
    status: 503,
  });
  await assert.rejects(whoIsSignedIn(fake(new TypeError("fetch failed")), "warden"), TypeError);
});
