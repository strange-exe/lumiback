import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** public/app/android.json: the latest Android app build per channel, read by the app to ask
 * for a download when a new build exists (apps/mobile/src/updates/native-build.ts). */
const file = JSON.parse(
  readFileSync(new URL("../../public/app/android.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

test("each published channel names a build, a minimum and an https download", () => {
  for (const [channel, info] of Object.entries(file)) {
    if (info === null) continue; // nothing published on this channel yet
    const { build, min_build, url, notes } = info as Record<string, unknown>;
    assert.ok(Number.isInteger(build) && Number(build) >= 1, `${channel}.build`);
    assert.ok(
      Number.isInteger(min_build) && Number(min_build) >= 1 && Number(min_build) <= Number(build),
      `${channel}.min_build must be between 1 and build`,
    );
    assert.match(String(url), /^https:\/\//, `${channel}.url`);
    assert.equal(typeof notes, "string", `${channel}.notes`);
  }
  assert.ok("preview" in file, "the preview channel is listed");
});
