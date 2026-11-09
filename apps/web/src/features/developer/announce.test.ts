import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  announceBody,
  announceDraft,
  announceError,
  announceTiming,
  MAX_ANNOUNCE_BODY,
  MAX_ANNOUNCE_TITLE,
  reachedLine,
} from "./announce.ts";

const NL = String.fromCodePoint(0x0a);
const ZWSP = String.fromCodePoint(0x200b);

test("the draft is the release's title and summary", () => {
  assert.deepEqual(announceDraft({ title: "Faster", summary: "It's quicker.", points: ["A."] }), {
    title: "Faster",
    body: "It's quicker.",
  });
});

test("the draft falls back to a short first point, and leaves too-long text empty", () => {
  assert.deepEqual(announceDraft({ title: "Faster", points: ["Opens quicker."] }), {
    title: "Faster",
    body: "Opens quicker.",
  });
  const long = { title: "t".repeat(51), summary: "s".repeat(141), points: ["p".repeat(141)] };
  assert.deepEqual(announceDraft(long), { title: "", body: "" });
});

test("the current release has a draft that can be sent as it is", () => {
  const [current] = JSON.parse(
    readFileSync(new URL("../../lib/changelog.json", import.meta.url), "utf8"),
  ) as { title: string; summary?: string; points: string[] }[];
  const draft = announceDraft(current!);
  assert.ok(announceBody(draft.title, draft.body).ok, "Add a summary (up to 140) to the release");
});

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

test("when the last one went out, and nothing about a next one (no daily limit)", () => {
  const fmt = (iso: string): string => `[${iso}]`;
  assert.equal(announceTiming({ last_at: null, next_at: null }, fmt), "No update announced yet.");
  assert.equal(
    announceTiming({ last_at: "2026-11-08T10:00:00Z", next_at: null }, fmt),
    "Last announced [2026-11-08T10:00:00Z].",
  );
  // An older API's next_at changes nothing.
  assert.equal(
    announceTiming({ last_at: "2026-11-08T10:00:00Z", next_at: "2026-11-09T10:00:00Z" }, fmt),
    "Last announced [2026-11-08T10:00:00Z].",
  );
});

test("how many phones it reached", () => {
  assert.equal(reachedLine(1), "Sending to 1 phone.");
  assert.equal(reachedLine(214), "Sending to 214 phones.");
  assert.equal(reachedLine(0), "Announced, but no phones have the app to receive it.");
});

test("refusals show the server's own words; a 403 says who may announce", () => {
  const noPush = "Push notifications aren't set up on this server, so nothing was sent.";
  assert.equal(announceError(503, noPush), noPush);
  assert.equal(announceError(403, "Developers only"), "Only developers can announce updates.");
  assert.equal(announceError(422, "Bad title"), "Bad title");
});
