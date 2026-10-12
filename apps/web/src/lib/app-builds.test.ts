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
    // From build 2 the app downloads the APK itself and installs it only if both match.
    const { size, md5 } = info as Record<string, unknown>;
    if (size !== undefined)
      assert.ok(Number.isInteger(size) && Number(size) > 0, `${channel}.size`);
    if (md5 !== undefined) assert.match(String(md5), /^[0-9a-f]{32}$/, `${channel}.md5`);
    // From build 3: one smaller APK per processor type, each checked the same way.
    const { apks } = info as { apks?: Record<string, Record<string, unknown>> };
    for (const [abi, apk] of Object.entries(apks ?? {})) {
      const at = `${channel}.apks.${abi}`;
      assert.ok(
        ["arm64-v8a", "armeabi-v7a", "x86_64", "x86", "universal"].includes(abi),
        `${at}: unknown ABI`,
      );
      assert.match(String(apk.url), /^https:\/\//, `${at}.url`);
      assert.ok(Number.isInteger(apk.size) && Number(apk.size) > 0, `${at}.size`);
      assert.match(String(apk.md5), /^[0-9a-f]{32}$/, `${at}.md5`);
    }
    // With the universal APK listed, the top-level url may be the download page (for build 1).
    // Builds that download it themselves check it against the top-level size and MD5, which
    // must stay the universal APK's, so the page fails the check and is never installed.
    const universal = apks?.universal;
    if (universal) {
      assert.equal(size, universal.size, `${channel}.size must match apks.universal.size`);
      assert.equal(md5, universal.md5, `${channel}.md5 must match apks.universal.md5`);
    }
  }
  assert.ok("preview" in file, "the preview channel is listed");
});
