import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { compareVersions } from "../../lib/version.ts";
import { planTour, STEPS, stepText, tourLabel, type TourPlan } from "./steps.ts";

/** The site's version: the newest changelog entry (what CURRENT.version is in changelog.ts). */
const CURRENT = (
  JSON.parse(readFileSync(new URL("../../lib/changelog.json", import.meta.url), "utf8")) as {
    version: string;
  }[]
)[0]!.version;

const ids = (plan: TourPlan | null): string[] | null => plan?.steps.map((s) => s.id) ?? null;

// ---------- planTour (the app's cases, on the website's steps) ----------

test("walks a student through everything the first time", () => {
  const plan = planTour({ seen: null, current: "1.14.0", audience: "student" });
  assert.equal(plan?.kind, "welcome");
  assert.deepEqual(ids(plan), ["status", "checkout", "history", "share", "account"]);
});

test("gives staff their own tour, without the student-only controls", () => {
  const plan = planTour({ seen: null, current: "1.14.0", audience: "staff" });
  assert.deepEqual(ids(plan), [
    "register",
    "requests",
    "corrections",
    "escalations",
    "people",
    "staff-tour",
  ]);
});

test("after an update, shows only what that release added or changed", () => {
  const plan = planTour({ seen: "1.12.1", current: "1.14.0", audience: "student" });
  assert.equal(plan?.kind, "new");
  assert.deepEqual(ids(plan), ["status", "history", "account"]);
  assert.deepEqual(ids(planTour({ seen: "1.13.0", current: "1.14.0", audience: "student" })), [
    "account",
  ]);
  assert.deepEqual(ids(planTour({ seen: "1.13.0", current: "1.14.0", audience: "staff" })), [
    "staff-tour",
  ]);
});

test("shows nothing on the same version, or when an update changed no control", () => {
  assert.equal(planTour({ seen: "1.14.0", current: "1.14.0", audience: "student" }), null);
  assert.equal(planTour({ seen: "1.14.0", current: "1.14.1", audience: "student" }), null);
  // Nothing on the staff side arrived or changed in 1.12.1 or earlier.
  assert.equal(planTour({ seen: "1.12.0", current: "1.12.1", audience: "staff" }), null);
});

test("never announces a step from a release this site doesn't have yet", () => {
  assert.equal(planTour({ seen: "1.11.0", current: "1.12.1", audience: "student" }), null);
  // Seen a newer version than this one (a rollback): nothing.
  assert.equal(planTour({ seen: "2.0.0", current: "1.14.0", audience: "student" }), null);
});

test("replays the whole tour from Account, whatever was seen", () => {
  const plan = planTour({ seen: "1.14.0", current: "1.14.0", audience: "student", replay: true });
  assert.equal(plan?.kind, "welcome");
  assert.equal(plan?.steps.length, 5);
});

test("an audience with no steps gets no tour", () => {
  assert.equal(planTour({ seen: null, current: "1.14.0", audience: "staff", steps: [] }), null);
});

// ---------- copy ----------

test("uses the update wording after an update, the full wording otherwise", () => {
  const status = STEPS.find((s) => s.id === "status")!;
  assert.equal(stepText(status, "new"), status.changed);
  assert.equal(stepText(status, "welcome"), status.body);
  const share = STEPS.find((s) => s.id === "share")!;
  assert.equal(stepText(share, "new"), share.body);
});

test("labels the card Quick tour, or New in the version after an update", () => {
  assert.equal(tourLabel("welcome", "1.14.0"), "Quick tour");
  assert.equal(tourLabel("new", "1.14.0"), "New in 1.14.0");
});

test("is plain: no exclamation marks, every step titled and explained", () => {
  for (const s of STEPS) {
    assert.ok(s.title.length > 0, s.id);
    assert.ok(s.body.length > 20, s.id);
    assert.doesNotMatch(`${s.title} ${s.body} ${s.changed ?? ""}`, /!/, s.id);
  }
});

test("uses plain ASCII punctuation (no dashes or middle dots from a word processor)", () => {
  for (const s of STEPS) {
    const words = `${s.title} ${s.body} ${s.changed ?? ""}`;
    const odd = [...words].filter((c) => c.codePointAt(0)! > 0x7e);
    assert.deepEqual(odd, [], s.id);
  }
});

test("dates every step at or before the site's own version", () => {
  for (const s of STEPS) {
    assert.match(s.since, /^\d+\.\d+\.\d+$/, s.id);
    assert.ok(compareVersions(s.since, CURRENT) <= 0, `${s.id}: ${s.since} > ${CURRENT}`);
  }
});

test("has unique step ids", () => {
  assert.equal(new Set(STEPS.map((s) => s.id)).size, STEPS.length);
});

// ---------- versions ----------

test("compares versions part by part, as numbers", () => {
  assert.equal(compareVersions("1.14.0", "1.13.0"), 1);
  assert.equal(compareVersions("1.9.0", "1.13.0"), -1);
  assert.equal(compareVersions("1.12.1", "1.12.1"), 0);
  assert.equal(compareVersions("1.12", "1.12.0"), 0);
  assert.equal(compareVersions("2.0.0", "1.99.99"), 1);
});
