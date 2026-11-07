import assert from "node:assert/strict";
import { test } from "node:test";

import { ApiError, reachBackend, UNREACHABLE } from "./api-error.ts";

test("a network failure becomes a 503 ApiError that forms can show", async () => {
  const failing = () => Promise.reject(new TypeError("fetch failed"));
  await assert.rejects(reachBackend(failing), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 503);
    assert.equal(error.detail, UNREACHABLE);
    return true;
  });
});

test("a timeout or abort is the same unreachable error", async () => {
  const aborted = () =>
    Promise.reject(new DOMException("The operation timed out.", "TimeoutError"));
  await assert.rejects(reachBackend(aborted), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 503);
    return true;
  });
});

test("an ApiError raised before the request passes through unchanged", async () => {
  const injected = new ApiError(503, "Test failure requested by the e2e suite.");
  await assert.rejects(
    reachBackend(() => Promise.reject(injected)),
    (error: unknown) => error === injected,
  );
});

test("an answer, even an error status, is returned as it came", async () => {
  const response = new Response(JSON.stringify({ detail: "Nope" }), { status: 409 });
  assert.equal(await reachBackend(() => Promise.resolve(response)), response);
});
