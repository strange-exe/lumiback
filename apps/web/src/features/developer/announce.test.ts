import assert from "node:assert/strict";
import { test } from "node:test";

import {
  announceBody,
  announceError,
  announceTiming,
  MAX_ANNOUNCE_BODY,
  MAX_ANNOUNCE_TITLE,
  reachedLine,
} from "./announce.ts";

const NL = String.fromCodePoint(0x0a);
const ZWSP = String.fromCodePoint(0x200b);

test("a title of up to 50 and one line of up to 140 characters, trimmed", () => {
  assert.equal(MAX_ANNOUNCE_TITLE, 50);
  assert.equal(MAX_ANNOUNCE_BODY, 140);
  assert.deepEqual(announceBody("  Lumiback 1.18  ", " Running late is here. "), {
    ok: true,
    body: { title: "Lumiback 1.18", body: "Running late is here." },
  });
  assert.deepEqual(announceBody("t".repeat(50), "b".repeat(140)), {
    ok: true,
    body: { title: "t".repeat(50), body: "b".repeat(140) },
  });
});

test("both are required, within their limits, and plain one-line text", () => {
  assert.deepEqual(announceBody("", "Body"), { ok: false, error: "Add a title." });
  assert.deepEqual(announceBody("Title", "  "), {
    ok: false,
    error: "Add a line about the update.",
  });
  assert.deepEqual(announceBody("t".repeat(51), "Body"), {
    ok: false,
    error: "Keep the title to 50 characters.",
  });
  assert.deepEqual(announceBody("Title", "b".repeat(141)), {
    ok: false,
    error: "Keep the line to 140 characters.",
  });
  assert.deepEqual(announceBody(`Two${NL}lines`, "Body"), {
    ok: false,
    error: "Write the title as one line of plain text.",
  });
  assert.deepEqual(announceBody("Title", `Hidden${ZWSP}text`), {
    ok: false,
    error: "Write the line as one line of plain text.",
  });
});

test("when the last one went out and when the next is allowed", () => {
  const fmt = (iso: string): string => `[${iso}]`;
  const now = Date.parse("2026-11-08T12:00:00Z");
  assert.deepEqual(announceTiming({ last_at: null, next_at: null }, now, fmt), {
    last: "No update announced yet.",
    next: "You can announce now.",
    allowed: true,
  });
  assert.deepEqual(
    announceTiming({ last_at: "2026-11-08T10:00:00Z", next_at: "2026-11-09T10:00:00Z" }, now, fmt),
    {
      last: "Last announced [2026-11-08T10:00:00Z].",
      next: "You can announce again after [2026-11-09T10:00:00Z].",
      allowed: false,
    },
  );
  // A next time already passed (the page was open a while) means allowed now.
  assert.deepEqual(
    announceTiming({ last_at: "2026-11-07T10:00:00Z", next_at: "2026-11-08T10:00:00Z" }, now, fmt),
    {
      last: "Last announced [2026-11-07T10:00:00Z].",
      next: "You can announce now.",
      allowed: true,
    },
  );
});

test("how many phones it reached", () => {
  assert.equal(reachedLine(1), "Sending to 1 phone.");
  assert.equal(reachedLine(214), "Sending to 214 phones.");
  assert.equal(reachedLine(0), "Announced, but no phones have the app to receive it.");
});

test("refusals show the server's own words; a 403 says who may announce", () => {
  const twice =
    "An update was already announced in the last 24 hours. You can announce again after 9:00 PM.";
  assert.equal(announceError(409, twice), twice);
  assert.equal(announceError(403, "Developers only"), "Only developers can announce updates.");
  assert.equal(announceError(422, "Bad title"), "Bad title");
});
