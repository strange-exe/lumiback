import assert from "node:assert/strict";
import { test } from "node:test";

import { ApiError, UNREACHABLE, VIEW_AS_READ_ONLY } from "../../lib/api-error.ts";
import { BULK_MAX, bulkIds, bulkOp, bulkSummary, runEach, type BulkOutcome } from "./bulk.ts";

const id = (n: number) => `5f0c2a1e-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("the three actions, and nothing else", () => {
  assert.equal(bulkOp("move"), "move");
  assert.equal(bulkOp("link"), "link");
  assert.equal(bulkOp("off"), "off");
  for (const v of ["on", "delete", "role", "", null, undefined, ["off"]])
    assert.equal(bulkOp(v), null);
});

test("ids are UUIDs, deduplicated (case too), in the order ticked", () => {
  const upper = id(2).toUpperCase();
  assert.deepEqual(bulkIds([id(1), id(2), upper, id(1)]), { ids: [id(1), id(2)] });
});

test("anything that isn't a UUID refuses the whole submit", () => {
  for (const bad of ["../admin/users", "1", "", id(1) + "x", { id: id(1) }]) {
    const result = bulkIds([id(1), bad]);
    assert.ok("error" in result, String(bad));
    assert.match(result.error, /Reload the page/);
  }
});

test("nobody ticked, and more than the limit, are refused before anything is sent", () => {
  assert.deepEqual(bulkIds([]), { error: "Tick at least one person first." });
  assert.equal(BULK_MAX, 100);
  const many = Array.from({ length: BULK_MAX + 1 }, (_, n) => id(n));
  assert.deepEqual(bulkIds(many), {
    error: "Choose at most 100 people at a time. Nothing was changed.",
  });
  assert.equal((bulkIds(many.slice(0, BULK_MAX)) as { ids: string[] }).ids.length, BULK_MAX);
  // Duplicates don't count towards the limit.
  assert.ok("ids" in bulkIds([...many.slice(0, BULK_MAX), id(0)]));
});

test("each person is tried in turn, and a refusal doesn't stop the rest", async () => {
  const calls: string[] = [];
  const outcomes = await runEach([id(1), id(2), id(3)], async (who) => {
    calls.push(who);
    if (who === id(2)) throw new ApiError(409, "They're out right now.");
    return { name: `P${calls.length}`, message: "Turned off." };
  });
  assert.deepEqual(calls, [id(1), id(2), id(3)]);
  assert.deepEqual(outcomes, [
    { id: id(1), name: "P1", done: true, message: "Turned off." },
    { id: id(2), name: null, done: false, message: "They're out right now." },
    { id: id(3), name: "P3", done: true, message: "Turned off." },
  ]);
});

test("read-only, rate limits and an unreachable server stop at once", async () => {
  for (const [status, detail] of [
    [403, VIEW_AS_READ_ONLY],
    [429, "Too many attempts. Try again later."],
    [503, UNREACHABLE],
  ] as const) {
    let calls = 0;
    const outcomes = await runEach([id(1), id(2), id(3)], async () => {
      calls += 1;
      throw new ApiError(status, detail);
    });
    assert.equal(calls, 1, String(status));
    assert.deepEqual(
      outcomes.map((o) => [o.done, o.message]),
      [
        [false, detail],
        [false, `Not tried: ${detail}`],
        [false, `Not tried: ${detail}`],
      ],
    );
  }
});

test("a signed-out session or a bug is not swallowed", async () => {
  await assert.rejects(
    runEach([id(1)], async () => {
      throw new ApiError(401, "Not authenticated");
    }),
    (e: unknown) => e instanceof ApiError && e.status === 401,
  );
  await assert.rejects(
    runEach([id(1)], async () => {
      throw new TypeError("boom");
    }),
    TypeError,
  );
});

test("the summary counts in words", () => {
  const o = (done: boolean): BulkOutcome => ({ id: id(1), name: null, done, message: "" });
  assert.equal(bulkSummary("off", [o(true), o(true), o(false)]), "2 turned off, 1 not.");
  assert.equal(bulkSummary("move", [o(true)]), "1 moved.");
  assert.equal(bulkSummary("link", [o(false), o(false)]), "0 links sent, 2 not.");
  assert.equal(bulkSummary("link", [o(true)]), "1 link sent.");
});
