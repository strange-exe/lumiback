import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

test("the website's changelog is the app's changelog", () => {
  assert.deepEqual(
    read("./changelog.json"),
    read("../../../mobile/src/updates/changelog.json"),
    "Copy apps/mobile/src/updates/changelog.json to apps/web/src/lib/changelog.json",
  );
});
