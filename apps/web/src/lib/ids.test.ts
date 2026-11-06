import assert from "node:assert/strict";
import { test } from "node:test";

import { isUuid } from "./ids.ts";

test("record ids are UUIDs, in either case", () => {
  assert.equal(isUuid("3f2b8c1e-9d4a-4e7b-8c2f-1a2b3c4d5e6f"), true);
  assert.equal(isUuid("3F2B8C1E-9D4A-4E7B-8C2F-1A2B3C4D5E6F"), true);
});

test("anything that could change a backend path is refused", () => {
  for (const bad of [
    "",
    "../users",
    "..%2Fusers",
    "3f2b8c1e-9d4a-4e7b-8c2f-1a2b3c4d5e6f/../../admin/users",
    "3f2b8c1e-9d4a-4e7b-8c2f-1a2b3c4d5e6f?x=1",
    " 3f2b8c1e-9d4a-4e7b-8c2f-1a2b3c4d5e6f",
    "3f2b8c1e9d4a4e7b8c2f1a2b3c4d5e6f",
    null,
    undefined,
    42,
  ]) {
    assert.equal(isUuid(bad), false, String(bad));
  }
});
