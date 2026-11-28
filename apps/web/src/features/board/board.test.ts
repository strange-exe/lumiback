import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BOARD_CATEGORIES,
  boardError,
  boardPost,
  boardRow,
  bodyCounter,
  canPostToBoard,
  checkBody,
  checkTargets,
  checkTitle,
  countsText,
  defaultExpiry,
  draftArrival,
  draftFill,
  draftTargets,
  EXPIRY_CHOICES,
  hostelsText,
  MAX_BODY,
  normaliseBody,
  olderTimings,
  postedText,
  postId,
  postsToAllHostels,
  reachText,
  readBoardForm,
  replaceLabel,
  startTargets,
  STATUS_LABEL,
  announceHref,
  seeAllText,
  seenIds,
  studentRow,
  targetsFrom,
  unseenIds,
  untilText,
  withdrawReason,
} from "./board.ts";
import type { BoardPost, Role, StaffBoardPost } from "../../lib/types.ts";

const NL = String.fromCodePoint(0x0a);
const CR = String.fromCodePoint(0x0d);
const TAB = String.fromCodePoint(0x09);
const NUL = String.fromCodePoint(0x00);
const ZWSP = String.fromCodePoint(0x200b);
const ZWJ = String.fromCodePoint(0x200d);
const BIDI = String.fromCodePoint(0x202e);
const LINE_SEP = String.fromCodePoint(0x2028);
const PARA_SEP = String.fromCodePoint(0x2029);
const HANGUL_FILLER = String.fromCodePoint(0x3164);

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";

function post(over: Partial<StaffBoardPost> = {}): StaffBoardPost {
  return {
    id: 1,
    category: "timings",
    title: "Outing timings",
    body: "Weekdays: 6:00 AM to 9:00 PM",
    from_label: "Hostel office, A",
    created_at: "2026-11-20T10:00:00+05:30",
    expires_at: "2026-12-20T10:00:00+05:30",
    status: "active",
    all_hostels: false,
    hostels: [{ id: A, name: "A block" }],
    author: "You",
    students: 40,
    seen: 10,
    can_withdraw: true,
    ...over,
  };
}

// ---------- who ----------

test("wardens, head wardens, admins and developers post; a student never does", () => {
  // A developer has everything any role has, the board included (owner, 2026-11-27).
  const expected: Record<Role, boolean> = {
    student: false,
    warden: true,
    head_warden: true,
    admin: true,
    developer: true,
  };
  for (const [role, can] of Object.entries(expected)) {
    assert.equal(canPostToBoard(role as Role), can, role);
  }
});

test("head wardens, admins and developers post to all hostels; wardens never do", () => {
  assert.equal(postsToAllHostels("head_warden"), true);
  assert.equal(postsToAllHostels("admin"), true);
  assert.equal(postsToAllHostels("developer"), true);
  assert.equal(postsToAllHostels("warden"), false);
  assert.equal(postsToAllHostels("student"), false);
});

// ---------- expiry ----------

test("the categories and expiry choices are the API's", () => {
  assert.deepEqual(BOARD_CATEGORIES, ["timings", "mess", "laundry", "maintenance", "general"]);
  assert.deepEqual(EXPIRY_CHOICES, [1, 3, 7, 30, 60]);
});

test("timings posts show for 30 days by default, everything else for 7", () => {
  assert.equal(defaultExpiry("timings"), 30);
  for (const category of ["mess", "laundry", "maintenance", "general"] as const) {
    assert.equal(defaultExpiry(category), 7, category);
  }
});

test("'Shows until' is the date and time in campus time, days from now", () => {
  const now = new Date("2026-11-25T10:30:00+05:30");
  assert.equal(untilText(7, now), "Shows until Wed, 2 Dec, 10:30 AM");
  // Late evening UTC is already the next day on campus.
  assert.equal(untilText(1, new Date("2026-11-25T20:00:00Z")), "Shows until Fri, 27 Nov, 1:30 AM");
});

// ---------- validation mirror ----------

test("a title is one line of 1-60 characters with a letter or digit", () => {
  assert.deepEqual(checkTitle("  Mess menu  "), { ok: true, value: "Mess menu" });
  assert.deepEqual(checkTitle("x".repeat(60)), { ok: true, value: "x".repeat(60) });
  assert.equal(checkTitle("").ok, false);
  assert.equal(checkTitle("   ").ok, false);
  assert.equal(checkTitle("x".repeat(61)).ok, false);
  assert.equal(checkTitle("!!!").ok, false);
  assert.equal(checkTitle(HANGUL_FILLER).ok, false);
  for (const bad of [NL, CR, TAB, NUL, ZWSP, BIDI, LINE_SEP]) {
    assert.equal(checkTitle(`Mess${bad}menu`).ok, false, bad.codePointAt(0)?.toString(16));
    // A trailing one counts too, before any trimming hides it.
    assert.equal(checkTitle(`Mess menu${bad}`).ok, false, bad.codePointAt(0)?.toString(16));
  }
  assert.equal(checkTitle(`Mess${ZWJ}menu`).ok, true);
});

test("a title's length counts characters, not UTF-16 units", () => {
  const emoji = String.fromCodePoint(0x1f35b);
  assert.equal(checkTitle(`Dinner ${emoji.repeat(53)}`).ok, true); // 60 characters
  assert.equal(checkTitle(`Dinner ${emoji.repeat(54)}`).ok, false);
});

test("a body turns CRLF and CR into LF", () => {
  assert.equal(normaliseBody(`a${CR}${NL}b${CR}c`), `a${NL}b${NL}c`);
  assert.deepEqual(checkBody(`a${CR}${NL}b`), { ok: true, value: `a${NL}b` });
});

test("a body allows line breaks and one blank line, and refuses other control characters", () => {
  assert.deepEqual(checkBody(`a${NL}${NL}b`), { ok: true, value: `a${NL}${NL}b` });
  assert.equal(checkBody(`a${NL}${NL}${NL}b`).ok, false);
  for (const bad of [TAB, NUL, ZWSP, BIDI, LINE_SEP, PARA_SEP]) {
    assert.equal(checkBody(`a${bad}b`).ok, false, bad.codePointAt(0)?.toString(16));
  }
  assert.equal(checkBody(`a${ZWJ}b`).ok, true);
});

test("a body is 1-600 characters and at most 20 lines, after trimming", () => {
  assert.equal(checkBody("").ok, false);
  assert.equal(checkBody(`  ${NL}  `).ok, false);
  assert.equal(checkBody("x".repeat(MAX_BODY)).ok, true);
  assert.equal(checkBody(` ${"x".repeat(MAX_BODY)} `).ok, true);
  assert.equal(checkBody("x".repeat(MAX_BODY + 1)).ok, false);
  const lines = (n: number): string => Array.from({ length: n }, (_, i) => `line ${i}`).join(NL);
  assert.equal(checkBody(lines(20)).ok, true);
  assert.equal(checkBody(lines(21)).ok, false);
});

test("a body with markup is kept as typed (it is shown as text)", () => {
  const xss = "<img src=x onerror=alert(1)>";
  assert.deepEqual(checkBody(xss), { ok: true, value: xss });
});

test("the counter counts characters and speaks only near the limit", () => {
  const short = bodyCounter("hello");
  assert.equal(short.count, 5);
  assert.equal(short.over, false);
  assert.equal(short.text, "5 of 600 characters");
  assert.equal(short.announce, "");
  const near = bodyCounter("x".repeat(560));
  assert.equal(near.announce, "40 characters left");
  const over = bodyCounter("x".repeat(612));
  assert.equal(over.over, true);
  assert.equal(over.text, "612 of 600 characters: 12 too many");
  assert.equal(over.announce, "12 characters too many");
  assert.equal(bodyCounter(`a${CR}${NL}b`).count, 3);
});

test("targets are some hostels or all hostels, never both or neither", () => {
  assert.deepEqual(checkTargets([A, B], false), {
    ok: true,
    value: { hostel_ids: [A, B], all_hostels: false },
  });
  assert.deepEqual(checkTargets([A], true), {
    ok: true,
    value: { hostel_ids: [], all_hostels: true },
  });
  assert.equal(checkTargets([], false).ok, false);
  assert.equal(checkTargets([A, A], false).ok, false);
  assert.equal(checkTargets(["not-a-uuid"], false).ok, false);
  const many = Array.from(
    { length: 51 },
    (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  );
  assert.equal(checkTargets(many, false).ok, false);
  assert.equal(checkTargets(many.slice(0, 50), false).ok, true);
});

test("a post's request has every field the API takes, and nothing else", () => {
  const checked = boardPost({
    category: "timings",
    title: " Outing timings ",
    body: `Weekdays${CR}${NL}Sunday`,
    hostel_ids: [A],
    all_hostels: false,
    expires_in_days: "30",
    replace_timings: true,
  });
  assert.deepEqual(checked, {
    ok: true,
    value: {
      category: "timings",
      title: "Outing timings",
      body: `Weekdays${NL}Sunday`,
      hostel_ids: [A],
      all_hostels: false,
      expires_in_days: 30,
      replace_timings: true,
    },
  });
});

test("replace_timings goes only with a timings post", () => {
  const checked = boardPost({
    category: "mess",
    title: "Menu",
    body: "Paneer",
    hostel_ids: [],
    all_hostels: true,
    expires_in_days: "7",
    replace_timings: true,
  });
  assert.equal(checked.ok, true);
  if (checked.ok) assert.equal(checked.value.replace_timings, false);
});

test("a post refuses an unknown category or expiry", () => {
  const base = {
    category: "mess",
    title: "Menu",
    body: "Paneer",
    hostel_ids: [A],
    all_hostels: false,
    expires_in_days: "7",
    replace_timings: false,
  };
  assert.equal(boardPost({ ...base, category: "parcel" }).ok, false);
  assert.equal(boardPost({ ...base, expires_in_days: "14" }).ok, false);
  assert.equal(boardPost({ ...base, expires_in_days: "" }).ok, false);
  assert.equal(boardPost({ ...base, title: "" }).ok, false);
  assert.equal(boardPost({ ...base, body: "" }).ok, false);
  assert.equal(boardPost({ ...base, hostel_ids: [] }).ok, false);
});

// ---------- the outing-rules draft ----------

test("the draft fills empty fields without asking", () => {
  const draft = { title: "Outing timings", body: "Weekdays: 6 AM" };
  assert.deepEqual(draftFill({ title: "", body: "  " }, draft), {
    fill: { title: "Outing timings", body: "Weekdays: 6 AM" },
    ask: false,
  });
});

test("the draft fills only the empty field and asks before replacing what was written", () => {
  const draft = { title: "Outing timings", body: "Weekdays: 6 AM" };
  assert.deepEqual(draftFill({ title: "My title", body: "" }, draft), {
    fill: { body: "Weekdays: 6 AM" },
    ask: true,
  });
  assert.deepEqual(draftFill({ title: "My title", body: "Mine" }, draft), {
    fill: {},
    ask: true,
  });
});

test("the draft doesn't ask when what was written is already the draft", () => {
  const draft = { title: "Outing timings", body: "Weekdays: 6 AM" };
  assert.deepEqual(draftFill(draft, draft), { fill: {}, ask: false });
});

test("a draft that arrives is checked against the fields as they are then, not when it was asked for", () => {
  const draft = { title: "Outing timings", body: "Weekdays: 6 AM" };
  const asked = { hostel_ids: [A, B], all_hostels: false };
  // The body was empty at the click, then typed while the draft was being written: ask first.
  assert.deepEqual(draftArrival(asked, { title: "", body: "Mine", targets: { ...asked } }, draft), {
    fill: { title: "Outing timings" },
    ask: true,
  });
  // The same hostels in another order are the same choice.
  assert.deepEqual(
    draftArrival(
      asked,
      { title: "", body: "", targets: { hostel_ids: [B, A], all_hostels: false } },
      draft,
    ),
    { fill: draft, ask: false },
  );
});

test("a draft for hostels that were changed while it was written is dropped", () => {
  const draft = { title: "Outing timings", body: "Weekdays: 6 AM" };
  const asked = { hostel_ids: [A], all_hostels: false };
  const empty = { title: "", body: "" };
  assert.equal(
    draftArrival(asked, { ...empty, targets: { hostel_ids: [A, C], all_hostels: false } }, draft),
    null,
  );
  assert.equal(
    draftArrival(asked, { ...empty, targets: { hostel_ids: [], all_hostels: true } }, draft),
    null,
  );
  assert.equal(
    draftArrival(
      { hostel_ids: [], all_hostels: true },
      { ...empty, targets: { hostel_ids: [A], all_hostels: false } },
      draft,
    ),
    null,
  );
});

test("?draft=<rule set> preselects the hostels following it, else All hostels for every-hostel staff", () => {
  const SET = "00000000-0000-4000-8000-0000000000f1";
  const OTHER = "00000000-0000-4000-8000-0000000000f2";
  const hostels = [
    { id: A, rule_set_id: SET },
    { id: B, rule_set_id: OTHER },
    { id: C, rule_set_id: SET },
  ];
  assert.deepEqual(draftTargets(SET, hostels, false), { hostel_ids: [A, C], all_hostels: false });
  assert.deepEqual(draftTargets(SET, hostels, true), { hostel_ids: [A, C], all_hostels: false });
  const unused = "00000000-0000-4000-8000-0000000000f3";
  assert.deepEqual(draftTargets(unused, hostels, true), { hostel_ids: [], all_hostels: true });
  assert.equal(draftTargets(unused, hostels, false), null);
  assert.equal(draftTargets("not-a-uuid", hostels, true), null);
  assert.equal(draftTargets(undefined, hostels, true), null);
});

// ---------- counts, reach, status ----------

// The server sends the seen count rounded down to a step of 5, or null near either edge
// (owner, 2026-11-26): the line says the step, never a number it doesn't know.
test("counts are two facts, never 'N of M', a step of 5, and hidden near either edge", () => {
  assert.equal(countsText(312, 240), "Sent to 312 students, seen by 240 to 244");
  assert.equal(countsText(10, 5), "Sent to 10 students, seen by 5 to 9");
  const hidden = "A seen count shows once at least 5 have opened it and 5 haven't.";
  assert.equal(countsText(40, null), `Sent to 40 students. ${hidden}`);
  assert.equal(countsText(4, null), `Sent to 4 students. ${hidden}`);
  assert.equal(countsText(1, null), `Sent to 1 student. ${hidden}`);
  assert.equal(countsText(0, null), `Sent to 0 students. ${hidden}`);
});

test("the reach line says students and phones", () => {
  assert.equal(
    reachText({ students: 312, devices: 240 }),
    "For 312 students, 240 phones get a notification",
  );
  assert.equal(
    reachText({ students: 1, devices: 1 }),
    "For 1 student, 1 phone gets a notification",
  );
  assert.equal(
    reachText({ students: 12, devices: 0 }),
    "For 12 students, no phones get a notification",
  );
  assert.equal(reachText({ students: 0, devices: 0 }), "No students are in these hostels yet");
});

test("status is text", () => {
  assert.deepEqual(STATUS_LABEL, { active: "Active", ended: "Ended", withdrawn: "Withdrawn" });
});

test("hostels read as names, All hostels, or a note when they were removed", () => {
  assert.equal(hostelsText(post()), "A block");
  assert.equal(
    hostelsText(
      post({
        hostels: [
          { id: A, name: "A block" },
          { id: B, name: "B block" },
        ],
      }),
    ),
    "A block, B block",
  );
  assert.equal(hostelsText(post({ all_hostels: true, hostels: [] })), "All hostels");
  assert.equal(hostelsText(post({ hostels: [] })), "Hostels since removed");
});

// ---------- withdrawing ----------

test("a post the sender can't take down says who posted it", () => {
  assert.equal(withdrawReason(post()), null);
  assert.equal(
    withdrawReason(post({ can_withdraw: false, author: "Head warden" })),
    "Posted by the head warden",
  );
  assert.equal(
    withdrawReason(post({ can_withdraw: false, author: "Admin" })),
    "Posted by an admin",
  );
  assert.equal(
    withdrawReason(post({ can_withdraw: false, author: "Warden" })),
    "Posted by another warden",
  );
  // Nothing to explain once it is off the board.
  assert.equal(withdrawReason(post({ can_withdraw: false, status: "ended" })), null);
  assert.equal(withdrawReason(post({ can_withdraw: false, status: "withdrawn" })), null);
});

test("older timings posts are the active ones the sender may take down that the new post covers", () => {
  const posts = [
    post({ id: 1 }),
    post({
      id: 2,
      hostels: [
        { id: A, name: "A" },
        { id: B, name: "B" },
      ],
    }),
    post({ id: 3, can_withdraw: false }),
    post({ id: 4, status: "ended" }),
    post({ id: 5, category: "mess" }),
    post({ id: 6, all_hostels: true, hostels: [] }),
    post({ id: 7, hostels: [] }), // its hostels were removed: covered by anything
    post({ id: 8, hostels: [{ id: C, name: "C" }] }),
  ];
  const ids = (list: StaffBoardPost[]): number[] => list.map((p) => p.id);
  assert.deepEqual(ids(olderTimings(posts, { hostel_ids: [A], all_hostels: false })), [1, 7]);
  assert.deepEqual(ids(olderTimings(posts, { hostel_ids: [A, B], all_hostels: false })), [1, 2, 7]);
  assert.deepEqual(
    ids(olderTimings(posts, { hostel_ids: [], all_hostels: true })),
    [1, 2, 6, 7, 8],
  );
});

// ---------- the list's rows ----------

test("a row is formatted text: status, dates, counts and who it was from", () => {
  const fmt = (iso: string): string => `<${iso.slice(0, 10)}>`;
  assert.deepEqual(boardRow(post(), fmt), {
    id: 1,
    title: "Outing timings",
    body: "Weekdays: 6:00 AM to 9:00 PM",
    category: "Timings",
    status: "Active",
    hostels: "A block",
    posted: "Posted <2026-11-20>",
    until: "Until <2026-12-20>",
    counts: "Sent to 40 students, seen by 10 to 14",
    from: "From: You",
    canWithdraw: true,
    reason: null,
  });
  const ended = boardRow(post({ status: "ended" }), fmt);
  assert.equal(ended.until, "Ended <2026-12-20>");
  assert.equal(ended.canWithdraw, false);
  const withdrawn = boardRow(post({ status: "withdrawn" }), fmt);
  assert.equal(withdrawn.until, "Taken down before <2026-12-20>");
  assert.equal(withdrawn.canWithdraw, false);
});

test("a post id from a form is a whole number inside BIGINT, else null", () => {
  assert.equal(postId("1"), "1");
  assert.equal(postId("9223372036854775807"), "9223372036854775807");
  for (const bad of [
    "",
    "0",
    "-1",
    "01",
    "1.5",
    "1e3",
    " 1",
    "abc",
    "9223372036854775808",
    "../x",
  ]) {
    assert.equal(postId(bad), null, JSON.stringify(bad));
  }
});

// ---------- errors ----------

test("errors name what to do", () => {
  assert.match(boardError(404, "Not found", "post"), /hostels/);
  assert.match(boardError(404, "Not found", "withdraw"), /isn't on/);
  assert.match(boardError(429, "Too many requests", "post"), /10 posts an hour/);
  assert.equal(
    boardError(403, "Only head wardens and admins post to all hostels", "post"),
    "Only head wardens and admins post to all hostels",
  );
});

// ---------- the form, as the server action reads it ----------

test("the form reads every field as typed, the body untrimmed and hostels in order", () => {
  const form = new FormData();
  form.set("category", "timings");
  form.set("title", " Outing timings ");
  form.set("body", `  Weekdays${CR}${NL}Sunday  `);
  form.append("hostel_ids", A);
  form.append("hostel_ids", B);
  form.set("expires_in_days", "30");
  form.set("replace_timings", "on");
  assert.deepEqual(readBoardForm(form), {
    category: "timings",
    title: " Outing timings ",
    body: `  Weekdays${CR}${NL}Sunday  `,
    hostel_ids: [A, B],
    all_hostels: false,
    expires_in_days: "30",
    replace_timings: true,
  });
});

test("the form reads All hostels and leaves out what is missing", () => {
  const form = new FormData();
  form.set("all_hostels", "on");
  form.append("hostel_ids", A);
  assert.deepEqual(readBoardForm(form), {
    category: "",
    title: "",
    body: "",
    hostel_ids: [A],
    all_hostels: true,
    expires_in_days: "",
    replace_timings: false,
  });
  // All hostels wins over any ticked hostel: nothing else is sent.
  const checked = boardPost({
    ...readBoardForm(form),
    category: "mess",
    title: "Menu",
    body: "Paneer",
    expires_in_days: "7",
  });
  assert.equal(checked.ok, true);
  if (checked.ok) assert.deepEqual(checked.value.hostel_ids, []);
});

test("the form ignores a file or a repeated field where text belongs", () => {
  const form = new FormData();
  form.set("title", new Blob(["x"]));
  form.append("hostel_ids", new Blob(["x"]));
  form.append("hostel_ids", A);
  const fields = readBoardForm(form);
  assert.equal(fields.title, "");
  assert.deepEqual(fields.hostel_ids, [A]);
});

test("a sent post says who it reached", () => {
  assert.equal(
    postedText({ id: 9, students: 312, devices: 240 }),
    "Posted. For 312 students, 240 phones get a notification.",
  );
  assert.equal(
    postedText({ id: 9, students: 0, devices: 0 }),
    "Posted. No students are in these hostels yet.",
  );
});

// ---------- the page's starting point and the actions' input ----------

test("targets handed to a server action are checked like the form's", () => {
  assert.deepEqual(targetsFrom({ hostel_ids: [A, B], all_hostels: false }), {
    ok: true,
    value: { hostel_ids: [A, B], all_hostels: false },
  });
  assert.deepEqual(targetsFrom({ hostel_ids: [A], all_hostels: true }), {
    ok: true,
    value: { hostel_ids: [], all_hostels: true },
  });
  // Anything a browser could send that isn't the shape: refused, never passed on.
  for (const bad of [
    null,
    undefined,
    "x",
    42,
    [],
    {},
    { hostel_ids: A, all_hostels: false },
    { hostel_ids: [A, 7], all_hostels: false },
    { hostel_ids: ["../x"], all_hostels: false },
    { hostel_ids: [A, A], all_hostels: false },
    { hostel_ids: [], all_hostels: false },
    { hostel_ids: [A], all_hostels: "true" },
  ]) {
    assert.equal(targetsFrom(bad).ok, false, JSON.stringify(bad) ?? String(bad));
  }
});

test("a warden starts with their own hostels; every-hostel staff choose", () => {
  const hostels = [
    { id: A, name: "A block" },
    { id: B, name: "B block" },
  ];
  assert.deepEqual(startTargets("warden", hostels, null), {
    hostel_ids: [A, B],
    all_hostels: false,
  });
  assert.deepEqual(startTargets("head_warden", hostels, null), {
    hostel_ids: [],
    all_hostels: false,
  });
  assert.deepEqual(startTargets("admin", hostels, null), { hostel_ids: [], all_hostels: false });
  // ?draft=<rule set> wins when it names some.
  const fromDraft = { hostel_ids: [B], all_hostels: false };
  assert.deepEqual(startTargets("warden", hostels, fromDraft), fromDraft);
  assert.deepEqual(startTargets("admin", hostels, { hostel_ids: [], all_hostels: true }), {
    hostel_ids: [],
    all_hostels: true,
  });
});

test("the take-down choice names how many older timings posts go", () => {
  assert.equal(replaceLabel(1), "Take down the older timings post");
  assert.equal(replaceLabel(3), "Take down the 3 older timings posts");
});

// ---------- the rules page's "Announce this change" ----------

test("Announce this change links a rule set to the board, for those who post", () => {
  assert.equal(announceHref(A, 2, false, "head_warden"), `/admin/board?draft=${A}`);
  assert.equal(announceHref(A, 1, false, "admin"), `/admin/board?draft=${A}`);
  assert.equal(announceHref(A, 1, false, "warden"), `/admin/board?draft=${A}`);
  // The campus default with no hostel on it: "All hostels", which only every-hostel staff send.
  assert.equal(announceHref(A, 0, true, "admin"), `/admin/board?draft=${A}`);
  assert.equal(announceHref(A, 0, true, "head_warden"), `/admin/board?draft=${A}`);
  assert.equal(announceHref(A, 0, true, "warden"), null);
  // A developer posts as an admin does.
  assert.equal(announceHref(A, 3, false, "developer"), `/admin/board?draft=${A}`);
  assert.equal(announceHref(A, 0, true, "developer"), `/admin/board?draft=${A}`);
  // Never for those who don't post, and never with a malformed id in the link.
  assert.equal(announceHref(A, 3, false, "student"), null);
  assert.equal(announceHref("x&draft=1", 3, false, "admin"), null);
});

test("a rule set no hostel follows, other than the campus default, has nothing to announce", () => {
  // The draft is written from the sets hostels follow, so it wouldn't hold this set's timings.
  assert.equal(announceHref(A, 0, false, "admin"), null);
  assert.equal(announceHref(A, 0, false, "head_warden"), null);
});

// ---------- the student's side ----------

function studentPost(over: Partial<BoardPost> = {}): BoardPost {
  return {
    id: 7,
    category: "mess",
    title: "Mess closed Sunday lunch",
    body: `Lunch at the canteen.${NL}Dinner as usual.`,
    from_label: "Hostel office, Hostel 3",
    created_at: "2026-11-24T09:00:00+05:30",
    expires_at: "2026-12-01T09:00:00+05:30",
    seen: false,
    ...over,
  };
}

test("a student's post reads as text: category, from, posted, until and New", () => {
  const fmt = (iso: string) => `<${iso.slice(0, 10)}>`;
  const row = studentRow(studentPost({ body: "<img src=x onerror=alert(1)>" }), fmt);
  assert.deepEqual(row, {
    id: 7,
    title: "Mess closed Sunday lunch",
    body: "<img src=x onerror=alert(1)>",
    category: "Mess",
    from: "Hostel office, Hostel 3",
    posted: "Posted <2026-11-24>",
    until: "Until <2026-12-01>",
    isNew: true,
  });
  assert.equal(studentRow(studentPost({ seen: true }), fmt).isNew, false);
});

test("only the posts on screen that weren't seen go in the seen call", () => {
  assert.deepEqual(
    unseenIds([studentPost({ id: 3 }), studentPost({ id: 2, seen: true }), studentPost({ id: 1 })]),
    [3, 1],
  );
  assert.deepEqual(unseenIds([studentPost({ seen: true })]), []);
  assert.deepEqual(unseenIds([]), []);
  // The API takes at most 30 at once (GET /board returns at most 30).
  const many = Array.from({ length: 31 }, (_, i) => studentPost({ id: i + 1 }));
  assert.equal(unseenIds(many).length, 30);
});

test("the seen action accepts only a short list of whole post ids", () => {
  assert.deepEqual(seenIds([1, 2, 30]), [1, 2, 30]);
  assert.deepEqual(seenIds([5, 5]), [5]);
  for (const bad of [
    undefined,
    null,
    "1",
    {},
    [],
    [0],
    [-1],
    [1.5],
    ["1"],
    [Number.NaN],
    [Number.MAX_SAFE_INTEGER + 1],
    Array.from({ length: 31 }, (_, i) => i + 1),
  ]) {
    assert.equal(seenIds(bad), null, JSON.stringify(bad));
  }
});

test("home links to the full board only when it shows part of it", () => {
  assert.equal(seeAllText(0), null);
  assert.equal(seeAllText(3), null);
  assert.equal(seeAllText(4), "See all 4 posts");
  assert.equal(seeAllText(30), "See all 30 posts");
});
