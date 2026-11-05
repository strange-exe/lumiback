import assert from "node:assert/strict";
import { test } from "node:test";

import { SECURITY_HEADERS } from "./security-headers.ts";

const header = (key: string): string | undefined =>
  SECURITY_HEADERS.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;

test("no other site can frame a page (clickjacking on sign-out, share and approve buttons)", () => {
  const csp = header("Content-Security-Policy") ?? "";
  assert.match(csp, /(^|;)\s*frame-ancestors 'self'\s*(;|$)/);
  assert.equal(header("X-Frame-Options"), "SAMEORIGIN"); // browsers without frame-ancestors
});

test("the policy only limits framing, so it can't block the app's own scripts or styles", () => {
  const directives = (header("Content-Security-Policy") ?? "")
    .split(";")
    .map((d) => d.trim().split(/\s+/)[0])
    .filter(Boolean);
  assert.deepEqual(directives, ["frame-ancestors"]);
});

test("responses are never MIME-sniffed", () => {
  assert.equal(header("X-Content-Type-Options"), "nosniff");
});
