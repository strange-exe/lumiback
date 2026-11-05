import assert from "node:assert/strict";
import { test } from "node:test";

import {
  accessFromStatus,
  chooseCredential,
  claimKey,
  type Access,
  type Credential,
} from "./access.ts";

const KEY = "k".repeat(43); // the shape of a real safe-return key
const USER = "user-access-token";

/** A backend stand-in: what each credential may do, and a log of what was asked. */
function backend(user: Access, guest: Access) {
  const asked: Credential[] = [];
  const probe = async (credential: Credential): Promise<Access> => {
    asked.push(credential);
    return credential.kind === "user" ? user : guest;
  };
  return { asked, probe };
}

function jar() {
  const stored: string[] = [];
  return { stored, store: (key: string) => void stored.push(key) };
}

test("maps the backend's answer for GET /sessions/{id}", () => {
  assert.equal(accessFromStatus(200), "granted");
  assert.equal(accessFromStatus(403), "restricted"); // pending, or access ended
  assert.equal(accessFromStatus(404), "none");
  assert.equal(accessFromStatus(401), "none");
  assert.equal(accessFromStatus(422), "none");
  assert.equal(accessFromStatus(429), "unknown");
  assert.equal(accessFromStatus(503), "unknown");
  assert.equal(accessFromStatus(null), "unknown"); // network error
});

test("a made-up key stores nothing, so a crafted link can't lock anyone out", async () => {
  const { probe } = backend("granted", "none");
  const cookie = jar();
  assert.equal(await claimKey(KEY, { userToken: null, probe, store: cookie.store }), "invalid");
  assert.deepEqual(cookie.stored, []);
});

test("a malformed key is refused before asking the backend", async () => {
  const { asked, probe } = backend("none", "granted");
  const cookie = jar();
  for (const bad of ["", "short", `${KEY};x`, "k".repeat(101)]) {
    assert.equal(await claimKey(bad, { userToken: null, probe, store: cookie.store }), "invalid");
  }
  assert.deepEqual(asked, []);
  assert.deepEqual(cookie.stored, []);
});

test("a signed-out emergency contact with the real key gets the guest cookie", async () => {
  const { asked, probe } = backend("none", "granted");
  const cookie = jar();
  assert.equal(await claimKey(KEY, { userToken: null, probe, store: cookie.store }), "granted");
  assert.deepEqual(cookie.stored, [KEY]);
  assert.deepEqual(asked, [{ kind: "guest", token: KEY }]);
});

test("a contact signed into an unrelated account still gets the guest cookie", async () => {
  const { probe } = backend("none", "granted");
  const cookie = jar();
  assert.equal(await claimKey(KEY, { userToken: USER, probe, store: cookie.store }), "granted");
  assert.deepEqual(cookie.stored, [KEY]);
});

test("a signed-in user who can already see the share claims nothing", async () => {
  const { probe } = backend("granted", "granted");
  const cookie = jar();
  assert.equal(await claimKey(KEY, { userToken: USER, probe, store: cookie.store }), "own");
  assert.deepEqual(cookie.stored, []);
});

test("a key whose access ended, or a backend that can't answer, stores nothing", async () => {
  const ended = backend("none", "restricted");
  const cookie = jar();
  assert.equal(await claimKey(KEY, { userToken: null, ...ended, store: cookie.store }), "ended");
  const down = backend("none", "unknown");
  assert.equal(
    await claimKey(KEY, { userToken: null, probe: down.probe, store: cookie.store }),
    "unavailable",
  );
  const throws = async (): Promise<Access> => {
    throw new Error("offline");
  };
  assert.equal(
    await claimKey(KEY, { userToken: null, probe: throws, store: cookie.store }),
    "unavailable",
  );
  assert.deepEqual(cookie.stored, []);
});

test("one credential: used as is, without asking the backend", async () => {
  const { asked, probe } = backend("none", "none");
  assert.equal(await chooseCredential({ userToken: null, guestToken: null, probe }), null);
  assert.deepEqual(await chooseCredential({ userToken: USER, guestToken: null, probe }), {
    kind: "user",
    token: USER,
  });
  assert.deepEqual(await chooseCredential({ userToken: null, guestToken: KEY, probe }), {
    kind: "guest",
    token: KEY,
  });
  assert.deepEqual(asked, []);
});

test("signed in with a guest cookie too: the user's own access wins when it works", async () => {
  const user = { kind: "user", token: USER };
  const guest = { kind: "guest", token: KEY };
  const pick = (own: Access, key: Access) =>
    chooseCredential({ userToken: USER, guestToken: KEY, probe: backend(own, key).probe });

  // The sharer or an approved viewer, whatever cookie was planted.
  assert.deepEqual(await pick("granted", "granted"), user);
  assert.deepEqual(await pick("granted", "none"), user);
  // Waiting for approval (or ended) on their own account, and the cookie is no better.
  assert.deepEqual(await pick("restricted", "none"), user);
  assert.deepEqual(await pick("restricted", "unknown"), user);
  // Nothing on their own account: the guest cookie is the real emergency-contact pass.
  assert.deepEqual(await pick("none", "granted"), guest);
  assert.deepEqual(await pick("restricted", "granted"), guest);
  assert.deepEqual(await pick("none", "restricted"), guest);
  // Neither works: speak as the user, so the page says "not available" rather than a guest's.
  assert.deepEqual(await pick("none", "none"), user);
  assert.deepEqual(await pick("unknown", "none"), user);
});
