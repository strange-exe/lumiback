import { nativeUpdateFor } from "./native-build";

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
  });
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
