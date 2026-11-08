import assert from "node:assert/strict";
import { test } from "node:test";

import { endTabShare, type SelfCall } from "./sign-out-share.ts";

type Sent = { path: string; method: string; asSelf: boolean };

/** The API as it answers a developer viewing as a role: reads work, changes are refused unless
 * the call is made as the developer themselves (no view-as header). */
function api(shares: { id: string; source: string; status: string }[], viewing: boolean) {
  const sent: Sent[] = [];
  const call: SelfCall = async (path, options) => {
    const method = options.method ?? "GET";
    sent.push({ path, method, asSelf: options.asSelf === true });
    if (viewing && method !== "GET" && options.asSelf !== true) {
      throw new Error("Read-only while viewing as another role");
    }
    return path === "/sessions/mine" ? shares : undefined;
  };
  return { call, sent };
}

const TAB = { id: "s-tab", source: "tab_live", status: "active" };

test("signing out while viewing as a role still stops this tab's share", async () => {
  const { call, sent } = api([TAB], true);
  assert.equal(await endTabShare("access", call), "s-tab");
  assert.deepEqual(sent.at(-1), { path: "/sessions/s-tab/stop", method: "POST", asSelf: true });
});

test("a normal sign-out stops it the same way", async () => {
  const { call, sent } = api([TAB], false);
  assert.equal(await endTabShare("access", call), "s-tab");
  assert.equal(sent.at(-1)?.path, "/sessions/s-tab/stop");
});

test("an outing's safe-return share and ended shares are left alone", async () => {
  const shares = [
    { id: "s-outing", source: "outing", status: "active" },
    { id: "s-old", source: "tab_live", status: "ended" },
  ];
  const { call, sent } = api(shares, false);
  assert.equal(await endTabShare("access", call), null);
  assert.deepEqual(
    sent.map((s) => s.method),
    ["GET"],
  );
});

test("a failed lookup or stop never blocks the sign-out", async () => {
  const failing: SelfCall = async () => {
    throw new Error("offline");
  };
  assert.equal(await endTabShare("access", failing), null);
  const stopFails: SelfCall = async (path) => {
    if (path !== "/sessions/mine") throw new Error("offline");
    return [TAB];
  };
  assert.equal(await endTabShare("access", stopFails), null);
});
