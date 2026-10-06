import assert from "node:assert/strict";
import { test } from "node:test";

import { clientIpFrom } from "./client-ip.ts";

test("uses the edge proxy's X-Real-IP", () => {
  assert.equal(clientIpFrom(new Headers({ "x-real-ip": "203.0.113.7" })), "203.0.113.7");
  assert.equal(clientIpFrom(new Headers({ "x-real-ip": "2001:db8::1" })), "2001:db8::1");
});

test("never trusts a client-supplied X-Forwarded-For", () => {
  const spoofed = new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" });
  assert.equal(clientIpFrom(spoofed), null);
  spoofed.set("x-real-ip", "198.51.100.9");
  assert.equal(clientIpFrom(spoofed), "198.51.100.9");
});

test("rejects values that are not an IP address", () => {
  assert.equal(clientIpFrom(new Headers({ "x-real-ip": "<script>" })), null);
  assert.equal(clientIpFrom(new Headers({ "x-real-ip": "" })), null);
  assert.equal(clientIpFrom(new Headers()), null);
});
