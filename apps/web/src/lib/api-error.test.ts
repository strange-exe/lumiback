import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ApiError,
  errorFrom,
  reachBackend,
  readableDetail,
  SERVER_BUSY,
  UNREACHABLE,
  VIEW_AS_READ_ONLY,
} from "./api-error.ts";
import { READ_ONLY } from "./view-as.ts";

test("a structured detail keeps its code and shows its message", () => {
  const error = errorFrom(429, {
    detail: { code: "login_locked", message: "Too many wrong passwords." },
  });
  assert.equal(error.status, 429);
  assert.equal(error.code, "login_locked");
  assert.equal(error.detail, "Too many wrong passwords.");
});

test("a plain sentence has no code", () => {
  const error = errorFrom(401, { detail: "Invalid email or password" });
  assert.equal(error.detail, "Invalid email or password");
  assert.equal(error.code, null);
});

test("a validation list shows its first message", () => {
  const error = errorFrom(422, { detail: [{ msg: "Value error, Too short" }] });
  assert.equal(error.detail, "Too short");
});

test("an empty or odd body falls back by status", () => {
  // A 429 without the API's body came from the hosting edge, not from the person's attempts.
  assert.equal(errorFrom(429, null).detail, SERVER_BUSY);
  assert.equal(errorFrom(429, "<html>rate limited</html>").detail, SERVER_BUSY);
  assert.equal(
    errorFrom(429, { detail: "Too many attempts. Try again later." }).detail,
    "Too many attempts. Try again later.",
  );
  assert.equal(errorFrom(500, { detail: { code: 7 } }).detail, "Something went wrong. Try again.");
  assert.equal(errorFrom(500, { detail: { code: 7 } }).code, null);
});

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

test("a change refused while viewing as a role says what happened and how to get out", () => {
  assert.equal(READ_ONLY, "Read-only while viewing as another role"); // the API's exact words
  const copy = readableDetail(403, READ_ONLY);
  assert.equal(copy, VIEW_AS_READ_ONLY);
  assert.match(copy, /viewing as another role/);
  assert.match(copy, /read-only/);
  assert.match(copy, /Stop/);
  assert.doesNotMatch(copy, /!/);
  assert.deepEqual(
    [...copy].filter((c) => c.codePointAt(0)! > 0x7e),
    [],
  );
});

test("other refusals keep the API's own words", () => {
  assert.equal(readableDetail(403, "Not allowed"), "Not allowed");
  assert.equal(readableDetail(400, READ_ONLY), READ_ONLY); // only the 403 is the view-as refusal
  assert.equal(readableDetail(409, "That gate is in use"), "That gate is in use");
});
