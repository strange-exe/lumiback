import assert from "node:assert/strict";
import { test } from "node:test";

import { androidDownloads, megabytes } from "./app-downloads.ts";

const UNIVERSAL = "https://github.com/strange-exe/lumiback/releases/download/build-3/lumiback.apk";
const ARM64 =
  "https://github.com/strange-exe/lumiback/releases/download/build-3/lumiback-arm64-v8a.apk";
const ARMV7 =
  "https://github.com/strange-exe/lumiback/releases/download/build-3/lumiback-armeabi-v7a.apk";

test("only the universal APK: one download, no alternatives", () => {
  const { primary, others } = androidDownloads({ build: 2, url: UNIVERSAL, size: 123_989_277 });
  assert.equal(primary.url, UNIVERSAL);
  assert.equal(primary.size, 123_989_277);
  assert.deepEqual(others, []);
});

test("per-processor APKs: modern phones by default, then 32-bit, then universal", () => {
  const { primary, others } = androidDownloads({
    build: 3,
    url: UNIVERSAL,
    size: 124_000_000,
    apks: {
      "armeabi-v7a": { url: ARMV7, size: 47_000_000 },
      "arm64-v8a": { url: ARM64, size: 55_000_000 },
    },
  });
  assert.equal(primary.url, ARM64);
  assert.equal(primary.size, 55_000_000);
  assert.deepEqual(
    others.map((d) => d.url),
    [ARMV7, UNIVERSAL],
  );
});

test("never defaults to a 32-bit APK, and skips links that aren't https", () => {
  const { primary, others } = androidDownloads({
    build: 3,
    url: UNIVERSAL,
    apks: { "armeabi-v7a": { url: ARMV7 }, "arm64-v8a": { url: "http://x/a.apk" } },
  });
  assert.equal(primary.url, UNIVERSAL);
  assert.equal(primary.size, null);
  assert.deepEqual(
    others.map((d) => d.url),
    [ARMV7],
  );
});

test("the listed universal APK wins over the top-level link (the download page itself)", () => {
  const { primary, others } = androidDownloads({
    build: 3,
    url: "https://lumiback.abhinesh.codes/download",
    apks: {
      "arm64-v8a": { url: ARM64, size: 55_000_000 },
      universal: { url: UNIVERSAL, size: 124_000_000 },
    },
  });
  assert.equal(primary.url, ARM64);
  assert.deepEqual(
    others.map((d) => [d.url, d.size]),
    [[UNIVERSAL, 124_000_000]],
  );
});

test("megabytes", () => {
  assert.equal(megabytes(55_400_000), "55 MB");
  assert.equal(megabytes(10), "1 MB");
});
