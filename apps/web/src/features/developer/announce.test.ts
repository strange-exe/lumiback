import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  ANNOUNCE_KINDS,
  AUDIENCE_ROLES,
  audienceLabel,
  announceBody,
  announceDraft,
  announceError,
  announceOptions,
  announceTiming,
  BEST_TITLE,
  historyAudience,
  KIND_LABEL,
  KIND_PATTERN,
  MAX_ANNOUNCE_BODY,
  MAX_ANNOUNCE_TITLE,
  reachedLine,
  titleGuidance,
} from "./announce.ts";
import { VIEW_AS_READ_ONLY } from "../../lib/api-error.ts";
import { READ_ONLY } from "../../lib/view-as.ts";

const NL = String.fromCodePoint(0x0a);
const ZWSP = String.fromCodePoint(0x200b);

test("the draft is the release's title, summary and kind", () => {
  assert.deepEqual(
    announceDraft({ title: "Faster", summary: "It's quicker.", kind: "fix", points: ["A."] }),
    { title: "Faster", body: "It's quicker.", kind: "fix" },
  );
});

test("the draft falls back to a short first point, leaves too-long text empty, and is a notice", () => {
  assert.deepEqual(announceDraft({ title: "Faster", points: ["Opens quicker."] }), {
    title: "Faster",
    body: "Opens quicker.",
    kind: "notice",
  });
  const long = { title: "t".repeat(51), summary: "s".repeat(141), points: ["p".repeat(141)] };
  assert.deepEqual(announceDraft(long), { title: "", body: "", kind: "notice" });
});

test("the current release has a draft that can be sent as it is, with a kind", () => {
  const [current] = JSON.parse(
    readFileSync(new URL("../../lib/changelog.json", import.meta.url), "utf8"),
  ) as { title: string; summary?: string; kind?: string; points: string[] }[];
  assert.ok(current!.kind && (ANNOUNCE_KINDS as readonly string[]).includes(current!.kind));
  const draft = announceDraft(current!);
  assert.ok(announceBody(draft.title, draft.body).ok, "Add a summary (up to 140) to the release");
});

test("four kinds, named as the v2 string table names them, each with its title pattern", () => {
  assert.deepEqual(ANNOUNCE_KINDS, ["feature", "fix", "maintenance", "notice"]);
  assert.deepEqual(KIND_LABEL, {
    feature: "Release",
    fix: "Patch",
    maintenance: "Maintenance",
    notice: "Staff notice",
  });
  assert.deepEqual(KIND_PATTERN, {
    feature: "Now live: <feature>",
    fix: "Patch: <area>",
    maintenance: "Scheduled maintenance: <day>",
    notice: "<Subject> updated",
  });
});

test("the kind, audience and banner go with the text; a banner only on a feature launch", () => {
  assert.deepEqual(
    announceBody("Now live: Reports", "See your hostel's numbers.", {
      kind: "feature",
      audience: ["warden", "head_warden"],
      image: "lantern",
    }),
    {
      ok: true,
      body: {
        title: "Now live: Reports",
        body: "See your hostel's numbers.",
        kind: "feature",
        audience: ["warden", "head_warden"],
        image: "lantern",
      },
    },
  );
  const fix = announceBody("Patch: sign-in", "Fixed.", {
    kind: "fix",
    audience: "everyone",
    image: "lantern",
  });
  assert.ok(fix.ok && !("image" in fix.body), "A fix never carries a banner");
  assert.deepEqual(announceBody("Title", "Body", { kind: "notice", audience: [], image: null }), {
    ok: false,
    error: "Choose at least one role, or Everyone.",
  });
});

test("the form's choices: an unknown kind is a notice, roles only when chosen", () => {
  const form = (entries: [string, string][]): FormData => {
    const data = new FormData();
    for (const [k, v] of entries) data.append(k, v);
    return data;
  };
  assert.deepEqual(announceOptions(form([])), {
    kind: "notice",
    audience: "everyone",
    image: null,
  });
  assert.deepEqual(
    announceOptions(
      form([
        ["kind", "feature"],
        ["audience", "roles"],
        ["role", "warden"],
        ["role", "nobody"],
        ["role", "student"],
        ["image", "gate"],
      ]),
    ),
    { kind: "feature", audience: ["student", "warden"], image: "gate" },
  );
  // Roles ticked but "Everyone" chosen: everyone.
  assert.deepEqual(
    announceOptions(
      form([
        ["kind", "release"],
        ["audience", "everyone"],
        ["role", "warden"],
        ["image", ""],
      ]),
    ),
    { kind: "notice", audience: "everyone", image: null },
  );
});

test("title guidance: best under 40, up to 50", () => {
  assert.equal(BEST_TITLE, 40);
  assert.equal(titleGuidance(""), "Best under 40 characters (up to 50).");
  assert.equal(titleGuidance("x".repeat(12)), "12 characters. Best under 40 (up to 50).");
  assert.equal(
    titleGuidance("x".repeat(44)),
    "44 characters: over 40, so some phones may cut it short.",
  );
});

test("the audience in words, for the preview and the confirm step", () => {
  assert.deepEqual(AUDIENCE_ROLES, ["student", "warden", "head_warden", "admin", "developer"]);
  assert.equal(audienceLabel("everyone"), "every phone with Lumiback");
  assert.equal(audienceLabel(["student"]), "students");
  assert.equal(audienceLabel(["head_warden", "warden"]), "wardens and head wardens");
  assert.equal(audienceLabel(["developer", "admin", "student"]), "students, admins and developers");
  assert.equal(historyAudience("everyone"), "Everyone");
  assert.equal(historyAudience(["warden", "head_warden"]), "Wardens, head wardens");
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

test("a developer viewing as another role is told that, not that only developers may", () => {
  const copy = announceError(403, READ_ONLY);
  assert.equal(copy, VIEW_AS_READ_ONLY);
  assert.doesNotMatch(copy, /Only developers/);
  // Any other refusal keeps the server's own words.
  const other = "View as is for developers only";
  assert.equal(announceError(403, other), other);
});
