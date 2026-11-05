import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createSendHere,
  shareToStopOnSignOut,
  startTracking,
  syncChoice,
  type GeoLike,
  type StorageLike,
} from "./send-here.ts";

const SHARE = "5f0c2a1e-0000-4000-8000-000000000001";

function fakeGeo() {
  const calls = { watch: 0, clear: [] as number[], current: 0 };
  const geo: GeoLike = {
    watchPosition: () => {
      calls.watch += 1;
      return 7;
    },
    clearWatch: (id) => void calls.clear.push(id),
    getCurrentPosition: () => void (calls.current += 1),
  };
  return { calls, geo };
}

function fakeTimers() {
  const live = new Map<number, () => void>();
  let next = 1;
  return {
    live,
    timers: {
      setInterval: (run: () => void) => {
        live.set(next, run);
        return next++;
      },
      clearInterval: (id: number) => void live.delete(id),
    },
  };
}

function track(sessionId: string | null, sendingHere: boolean, geo: GeoLike | null) {
  const t = fakeTimers();
  const stop = startTracking({
    sessionId,
    sendingHere,
    geolocation: geo,
    timers: t.timers,
    onFix: () => {},
    onError: () => {},
    watch: {},
    heartbeat: {},
    heartbeatMs: 20_000,
  });
  return { stop, live: t.live };
}

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

test("a share this browser didn't opt into is never tracked: no watch, no heartbeat", () => {
  const { calls, geo } = fakeGeo();
  const { stop, live } = track(SHARE, false, geo);
  assert.equal(stop, undefined);
  assert.equal(calls.watch, 0);
  assert.equal(live.size, 0);
});

test("after the tap, location is watched with a heartbeat, and both stop on cleanup", () => {
  const { calls, geo } = fakeGeo();
  const { stop, live } = track(SHARE, true, geo);
  assert.equal(calls.watch, 1);
  assert.equal(live.size, 1);
  [...live.values()][0]?.(); // one heartbeat tick asks for a fresh fix
  assert.equal(calls.current, 1);
  stop?.();
  assert.deepEqual(calls.clear, [7]);
  assert.equal(live.size, 0);
});

test("nothing is tracked without a share or without geolocation", () => {
  const { calls, geo } = fakeGeo();
  assert.equal(track(null, true, geo).stop, undefined);
  assert.equal(track(SHARE, true, null).stop, undefined);
  assert.equal(calls.watch, 0);
});

test("the choice is remembered for this tab's session and can be cleared", () => {
  const storage = memoryStorage();
  const first = createSendHere(() => storage);
  assert.equal(first.get(), null); // nothing chosen: nothing sent
  first.set(SHARE);
  assert.equal(first.get(), SHARE);
  // A reload of the same tab (a fresh module) still knows.
  assert.equal(createSendHere(() => storage).get(), SHARE);
  first.set(null);
  assert.equal(createSendHere(() => storage).get(), null);
  assert.equal(storage.data.size, 0);
});

test("a blocked or throwing sessionStorage still works for this page, and never throws", () => {
  const throwing: StorageLike = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => {
      throw new Error("SecurityError");
    },
  };
  for (const storage of [() => throwing, () => null]) {
    const store = createSendHere(storage);
    assert.equal(store.get(), null);
    store.set(SHARE);
    assert.equal(store.get(), SHARE);
    store.set(null);
    assert.equal(store.get(), null);
  }
  const getterThrows = createSendHere(() => {
    throw new Error("SecurityError"); // window.sessionStorage itself can throw
  });
  assert.equal(getterThrows.get(), null);
});

test("the tab's choice is dropped once no share is shown (sign-out, account deleted)", () => {
  const store = createSendHere(() => memoryStorage());
  store.set(SHARE);
  // Signed out (or the account is gone): the layout passes no share.
  syncChoice(store, null);
  assert.equal(store.get(), null);
  // Signing back in to a still-running safe return must not resume sending without a new tap.
  syncChoice(store, SHARE);
  assert.equal(store.get(), null);
});

test("a choice for the share still shown is kept, and an unchanged one doesn't notify", () => {
  const store = createSendHere(() => memoryStorage());
  store.set(SHARE);
  let heard = 0;
  store.subscribe(() => (heard += 1));
  syncChoice(store, SHARE);
  assert.equal(store.get(), SHARE);
  syncChoice(store, null);
  syncChoice(store, null);
  assert.equal(heard, 1);
});

test("signing out stops only a tab share that this tab sends", () => {
  const tab = { id: SHARE, source: "tab_live" as const };
  const outing = { id: SHARE, source: "outing" as const };
  assert.equal(shareToStopOnSignOut(tab, true), SHARE);
  // Another tab (or device) sends it: that one still has a way to stop it.
  assert.equal(shareToStopOnSignOut(tab, false), null);
  // Safe return belongs to the outing and ends when the student is back.
  assert.equal(shareToStopOnSignOut(outing, true), null);
  assert.equal(shareToStopOnSignOut(null, true), null);
});

test("subscribers hear every change, and can unsubscribe", () => {
  const store = createSendHere(() => memoryStorage());
  let heard = 0;
  const off = store.subscribe(() => (heard += 1));
  store.set(SHARE);
  store.set(null);
  off();
  store.set(SHARE);
  assert.equal(heard, 2);
});
