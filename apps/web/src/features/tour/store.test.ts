import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AUTOMATION_OPT_IN,
  onReplay,
  readSeen,
  requestReplay,
  seenKey,
  takeReplay,
  tourAllowed,
  writeSeen,
  type TourStorage,
} from "./store.ts";

function memory(initial: Record<string, string> = {}): TourStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

const broken: TourStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

test("remembers the version per account", () => {
  const storage = memory();
  assert.equal(readSeen(storage, "u1", "1.14.0"), null);
  writeSeen(storage, "u1", "1.14.0");
  assert.equal(storage.data.get(seenKey("u1")), "1.14.0");
  assert.equal(readSeen(storage, "u1", "1.14.0"), "1.14.0");
  assert.equal(readSeen(storage, "u2", "1.14.0"), null); // another account on this browser
});

test("a stored value that isn't a version counts as never seen", () => {
  assert.equal(readSeen(memory({ [seenKey("u1")]: "yes" }), "u1", "1.14.0"), null);
});

test("blocked storage never throws, and doesn't show the tour on every page", () => {
  assert.equal(readSeen(broken, "u1", "1.14.0"), "1.14.0");
  assert.equal(readSeen(null, "u1", "1.14.0"), "1.14.0");
  assert.doesNotThrow(() => writeSeen(broken, "u1", "1.14.0"));
  assert.doesNotThrow(() => writeSeen(null, "u1", "1.14.0"));
});

test("automated browsers get the tour only when a test opts in", () => {
  assert.equal(tourAllowed(memory(), false), true);
  assert.equal(tourAllowed(null, false), true);
  assert.equal(tourAllowed(memory(), true), false);
  assert.equal(tourAllowed(memory({ [AUTOMATION_OPT_IN]: "1" }), true), true);
  assert.equal(tourAllowed(broken, true), false);
});

test("a replay request waits for one tour to take it", () => {
  let heard = 0;
  const off = onReplay(() => (heard += 1));
  assert.equal(takeReplay(), false);
  requestReplay();
  assert.equal(heard, 1);
  assert.equal(takeReplay(), true);
  assert.equal(takeReplay(), false); // only one tour gets it
  off();
  requestReplay();
  assert.equal(heard, 1);
  assert.equal(takeReplay(), true); // kept for a tour that mounts later
});
