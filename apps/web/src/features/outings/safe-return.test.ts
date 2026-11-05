import assert from "node:assert/strict";
import { test } from "node:test";

import { safeReturnShareToSend } from "./safe-return.ts";

const SHARE = "5f0c2a1e-0000-4000-8000-000000000001";

test("checking out with safe return opts the submitting tab in for the outing's share", () => {
  assert.equal(safeReturnShareToSend(true, { safe_return_session_id: SHARE }), SHARE);
});

test("nothing to send when safe return wasn't ticked, didn't start, or the reply is odd", () => {
  assert.equal(safeReturnShareToSend(false, { safe_return_session_id: SHARE }), null);
  assert.equal(safeReturnShareToSend(true, { safe_return_session_id: null }), null);
  assert.equal(safeReturnShareToSend(true, {}), null);
  assert.equal(safeReturnShareToSend(true, null), null);
  // Only an id shaped like a share id is remembered in this tab's storage.
  assert.equal(safeReturnShareToSend(true, { safe_return_session_id: "../stop" }), null);
});
