import { apkMatches, megabytes, nativeUpdateFor } from "./native-build";

const URL = "https://github.com/strange-exe/lumiback/releases/latest/download/lumiback.apk";
const file = (build: number, min_build = 1, url = URL) => ({
  preview: { build, min_build, url, notes: "Faster gate scans." },
  production: null,
});

test("asks when a newer build is published for this channel", () => {
  expect(nativeUpdateFor(file(2), "preview", 1)).toEqual({
    build: 2,
    url: URL,
    notes: "Faster gate scans.",
    required: false,
    size: null,
    md5: null,
    abi: null,
  });
});

const ARM64 =
  "https://github.com/strange-exe/lumiback/releases/download/build-3/lumiback-arm64-v8a.apk";
const ARMV7 =
  "https://github.com/strange-exe/lumiback/releases/download/build-3/lumiback-armeabi-v7a.apk";
const split = {
  production: {
    build: 3,
    min_build: 1,
    url: URL,
    size: 124_000_000,
    md5: "a".repeat(32),
    apks: {
      "arm64-v8a": { url: ARM64, size: 55_000_000, md5: "b".repeat(32) },
      "armeabi-v7a": { url: ARMV7, size: 47_000_000, md5: "c".repeat(32) },
    },
  },
};

test("picks the APK for the phone's preferred processor type", () => {
  const modern = ["arm64-v8a", "armeabi-v7a", "armeabi"];
  expect(nativeUpdateFor(split, "production", 2, modern)).toMatchObject({
    url: ARM64,
    size: 55_000_000,
    md5: "b".repeat(32),
    abi: "arm64-v8a",
  });
  expect(nativeUpdateFor(split, "production", 2, ["armeabi-v7a", "armeabi"])).toMatchObject({
    url: ARMV7,
    abi: "armeabi-v7a",
  });
});

test("falls back to the universal APK when no smaller one fits", () => {
  const universal = { url: URL, size: 124_000_000, md5: "a".repeat(32), abi: null };
  // An x86_64 emulator or Chromebook, unknown ABIs, and builds that don't pass any.
  expect(nativeUpdateFor(split, "production", 2, ["x86_64", "x86"])).toMatchObject(universal);
  expect(nativeUpdateFor(split, "production", 2, null)).toMatchObject(universal);
  expect(nativeUpdateFor(split, "production", 2)).toMatchObject(universal);
  // A malformed or non-https entry is skipped, never followed.
  const bad = {
    production: { ...split.production, apks: { "arm64-v8a": { url: "http://x/a.apk" } } },
  };
  expect(nativeUpdateFor(bad, "production", 2, ["arm64-v8a"])).toMatchObject(universal);
  const proto = { production: { ...split.production, apks: {} } };
  expect(nativeUpdateFor(proto, "production", 2, ["toString"])).toMatchObject(universal);
});

test("megabytes", () => {
  expect(megabytes(55_400_000)).toBe("55 MB");
  expect(megabytes(10)).toBe("1 MB");
});

const MD5 = "0123456789abcdef0123456789ABCDEF";

test("reads the APK's size and MD5 when published, ignoring malformed ones", () => {
  const withCheck = { preview: { build: 2, min_build: 1, url: URL, size: 81_000_000, md5: MD5 } };
  expect(nativeUpdateFor(withCheck, "preview", 1)).toMatchObject({
    size: 81_000_000,
    md5: MD5.toLowerCase(),
  });
  const bad = { preview: { build: 2, min_build: 1, url: URL, size: -1, md5: "not-a-hash" } };
  expect(nativeUpdateFor(bad, "preview", 1)).toMatchObject({ size: null, md5: null });
});

test("a downloaded APK installs only if it's exactly the published file", () => {
  const update = { size: 100, md5: MD5.toLowerCase() };
  expect(apkMatches(update, { size: 100, md5: MD5 })).toBe(true);
  expect(apkMatches(update, { size: 99, md5: MD5 })).toBe(false); // cut short
  expect(apkMatches(update, { size: 100, md5: "f".repeat(32) })).toBe(false); // corrupted
  expect(apkMatches({ size: null, md5: null }, { size: 0, md5: null })).toBe(false); // empty
  expect(apkMatches({ size: null, md5: null }, { size: 5, md5: null })).toBe(true); // unchecked
});

test("quiet when this is already the latest build, or newer", () => {
  expect(nativeUpdateFor(file(1), "preview", 1)).toBeNull();
  expect(nativeUpdateFor(file(1), "preview", 2)).toBeNull();
});

test("required when the installed build is below the minimum", () => {
  expect(nativeUpdateFor(file(3, 3), "preview", 2)?.required).toBe(true);
  expect(nativeUpdateFor(file(3, 2), "preview", 2)?.required).toBe(false);
});

test("quiet whenever something is unknown", () => {
  expect(nativeUpdateFor(file(2), null, 1)).toBeNull(); // development build: no channel
  expect(nativeUpdateFor(file(2), "preview", undefined)).toBeNull(); // build not in the list
  expect(nativeUpdateFor(file(2), "production", 1)).toBeNull(); // nothing published there
  expect(nativeUpdateFor(null, "preview", 1)).toBeNull();
  expect(nativeUpdateFor("<html>", "preview", 1)).toBeNull(); // an error page, not JSON
  expect(nativeUpdateFor({ preview: { build: "2", url: URL } }, "preview", 1)).toBeNull();
});

test("only opens https links", () => {
  expect(nativeUpdateFor(file(2, 1, "http://example.com/app.apk"), "preview", 1)).toBeNull();
  expect(nativeUpdateFor(file(2, 1, "javascript:alert(1)"), "preview", 1)).toBeNull();
});
