import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { cookieBase } from "./cookies.ts";

/** COOKIE_BASE as a fresh Node process sees it with this NODE_ENV (it is read at import). */
function secureUnder(nodeEnv: "production" | "development"): string {
  const url = new URL("./cookies.ts", import.meta.url).href;
  const run = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const m = await import(${JSON.stringify(url)}); console.log(String(m.COOKIE_BASE.secure));`,
    ],
    { env: { ...process.env, NODE_ENV: nodeEnv }, encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim();
}

test("every auth and guest cookie is Secure in production", () => {
  assert.equal(cookieBase("production").secure, true);
  assert.equal(secureUnder("production"), "true");
});

test("plain-http local development still works (not Secure outside production)", () => {
  assert.equal(cookieBase("development").secure, false);
  assert.equal(cookieBase(undefined).secure, false);
  assert.equal(secureUnder("development"), "false");
});

test("cookies stay httpOnly, SameSite=Lax and site-wide in every environment", () => {
  for (const env of ["production", "development", undefined]) {
    const base = cookieBase(env);
    assert.equal(base.httpOnly, true);
    assert.equal(base.sameSite, "lax");
    assert.equal(base.path, "/");
  }
});
