import assert from "node:assert/strict";
import { test } from "node:test";

import { clientIpFrom, visitorHeaders } from "./client-ip.ts";

const EDGE = "edge-" + "R4tP9wXc".repeat(5);
const CLOUDFLARE = { header: "cf-connecting-ip", edgeSecret: EDGE };

test("behind Cloudflare: trusts CF-Connecting-IP only with the edge secret", () => {
  const viaCloudflare = new Headers({ "cf-connecting-ip": "203.0.113.7", "x-edge-auth": EDGE });
  assert.equal(clientIpFrom(viaCloudflare, CLOUDFLARE), "203.0.113.7");

  // Straight to *.onrender.com with a forged header: no secret, no trust.
  const direct = new Headers({ "cf-connecting-ip": "1.2.3.4" });
  assert.equal(clientIpFrom(direct, CLOUDFLARE), null);
  const guessed = new Headers({ "cf-connecting-ip": "1.2.3.4", "x-edge-auth": EDGE.slice(1) });
  assert.equal(clientIpFrom(guessed, CLOUDFLARE), null);
});

test("never trusts X-Forwarded-For, and nothing at all when unconfigured", () => {
  const spoofed = new Headers({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8" });
  assert.equal(clientIpFrom(spoofed, CLOUDFLARE), null);
  assert.equal(clientIpFrom(spoofed, { header: null, edgeSecret: null }), null);
});

test("rejects values that are not an IP address", () => {
  const bad = new Headers({ "cf-connecting-ip": "<script>", "x-edge-auth": EDGE });
  assert.equal(clientIpFrom(bad, CLOUDFLARE), null);
  const v6 = new Headers({ "cf-connecting-ip": "2001:db8::1", "x-edge-auth": EDGE });
  assert.equal(clientIpFrom(v6, CLOUDFLARE), "2001:db8::1");
});

test("the API only hears about the visitor together with the shared secret", () => {
  assert.deepEqual(visitorHeaders("203.0.113.7", "s3cret"), {
    "X-Client-IP": "203.0.113.7",
    "X-Internal-Auth": "s3cret",
  });
  assert.deepEqual(visitorHeaders(null, "s3cret"), {});
  assert.deepEqual(visitorHeaders("203.0.113.7", null), {});
});
