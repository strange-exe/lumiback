/**
 * The hostel board, the office's side: who may post, the checks a post must pass (a mirror of
 * the API's BoardPostIn, so the office gets a plain message before anything is sent), the
 * outing-rules draft, and the words the page uses for reach, counts and status. The API checks
 * everything again. Pure, so `node --test` can load it.
 */

import { isUuid } from "../../lib/ids.ts";
import type {
  BoardCategory,
  BoardPost,
  BoardReach,
  BoardSent,
  BoardStatus,
  Role,
  StaffBoardPost,
} from "../../lib/types.ts";
import { formatDay, formatTime } from "../outings/time.ts";

// ---------- who ----------

/** Who posts to the board. Never a developer (the API refuses them too), never a student. */
export const POSTER_ROLES: readonly Role[] = ["warden", "head_warden", "admin"];

export function canPostToBoard(role: Role): boolean {
  return POSTER_ROLES.includes(role);
}

/** "All hostels" is for the staff who look after every hostel. */
export function postsToAllHostels(role: Role): boolean {
  return role === "head_warden" || role === "admin";
}

// ---------- categories and how long a post shows ----------

export const BOARD_CATEGORIES: readonly BoardCategory[] = [
  "timings",
  "mess",
  "laundry",
  "maintenance",
  "general",
];

export const CATEGORY_LABEL: Readonly<Record<BoardCategory, string>> = {
  timings: "Timings",
  mess: "Mess",
  laundry: "Laundry",
  maintenance: "Maintenance",
  general: "General",
};

export const EXPIRY_CHOICES = [1, 3, 7, 30, 60] as const;
export type ExpiryDays = (typeof EXPIRY_CHOICES)[number];

export const EXPIRY_LABEL: Readonly<Record<ExpiryDays, string>> = {
  1: "1 day",
  3: "3 days",
  7: "1 week",
  30: "30 days",
  60: "60 days",
};

function isCategory(value: string): value is BoardCategory {
  return (BOARD_CATEGORIES as readonly string[]).includes(value);
}

function isExpiry(value: number): value is ExpiryDays {
  return (EXPIRY_CHOICES as readonly number[]).includes(value);
}

/** The API's default: timings stay up for 30 days, anything else for a week. */
export function defaultExpiry(category: BoardCategory): ExpiryDays {
  return category === "timings" ? 30 : 7;
}

/** "Shows until Wed, 2 Dec, 10:30 AM": `days` from now, in campus time (as the API sets it). */
export function untilText(days: number, now: Date = new Date()): string {
  const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  return `Shows until ${formatDay(until)}, ${formatTime(until)}`;
}

// ---------- the checks (mirror of backend/app/schemas.py BoardTitle, BoardBody, BoardTargets) ----------

export const MAX_TITLE = 60;
export const MAX_BODY = 600;
export const MAX_LINES = 20;
export const MAX_HOSTELS = 50;
/** The counter starts speaking this many characters before the limit. */
const ANNOUNCE_FROM = MAX_BODY - 60;

const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
// Indic scripts spell real words with the zero-width non-joiner and joiner (as the API allows).
const JOINERS = new Set([String.fromCodePoint(0x200c), String.fromCodePoint(0x200d)]);
// Letters that show nothing (the Hangul fillers): a title of only these looks empty.
const INVISIBLE_LETTERS = new Set(
  [0x115f, 0x1160, 0x3164, 0xffa0].map((c) => String.fromCodePoint(c)),
);
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const LF = String.fromCodePoint(0x0a);
const CR = String.fromCodePoint(0x0d);

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

function plain(value: string): boolean {
  return ![...value].some((c) => INVISIBLE.test(c) && !JOINERS.has(c));
}

/** Characters as the API counts them (code points, not UTF-16 units). */
function length(value: string): number {
  return [...value].length;
}

/** CRLF and a lone CR become LF, as the API does first. */
export function normaliseBody(raw: string): string {
  return raw
    .split(CR + LF)
    .join(LF)
    .split(CR)
    .join(LF);
}

export function checkTitle(raw: string): Checked<string> {
  // Checked before trimming, so a trailing line break or tab can't hide.
  if (!plain(raw)) return { ok: false, error: "Write the title as one line of plain text." };
  const value = raw.trim();
  if (!value) return { ok: false, error: "Add a title." };
  if (length(value) > MAX_TITLE) {
    return { ok: false, error: `Keep the title to ${MAX_TITLE} characters.` };
  }
  if (![...value].some((c) => LETTER_OR_DIGIT.test(c) && !INVISIBLE_LETTERS.has(c))) {
    return { ok: false, error: "Give the title at least one letter or number." };
  }
  return { ok: true, value };
}

export function checkBody(raw: string): Checked<string> {
  const normalised = normaliseBody(raw);
  if (!plain(normalised.split(LF).join(""))) {
    return {
      ok: false,
      error: "Write the post as plain text: letters, numbers, punctuation and line breaks.",
    };
  }
  const value = normalised.trim();
  if (!value) return { ok: false, error: "Write what the post says." };
  const count = length(value);
  if (count > MAX_BODY) {
    return {
      ok: false,
      error: `Keep the post to ${MAX_BODY} characters. It has ${count}.`,
    };
  }
  if (value.includes(LF + LF + LF)) {
    return { ok: false, error: "Leave at most one blank line in a row." };
  }
  if (value.split(LF).length > MAX_LINES) {
    return { ok: false, error: `Keep the post to ${MAX_LINES} lines.` };
  }
  return { ok: true, value };
}

export interface BodyCounter {
  count: number;
  over: boolean;
  /** Always shown: "120 of 600 characters". */
  text: string;
  /** For a polite live region: empty until the body is near the limit. */
  announce: string;
}

export function bodyCounter(raw: string): BodyCounter {
  const count = length(normaliseBody(raw).trim());
  const over = count > MAX_BODY;
  const extra = count - MAX_BODY;
  const text = over
    ? `${count} of ${MAX_BODY} characters: ${extra} too many`
    : `${count} of ${MAX_BODY} characters`;
  let announce = "";
  if (over) announce = `${extra} ${extra === 1 ? "character" : "characters"} too many`;
  else if (count >= ANNOUNCE_FROM) {
    const left = MAX_BODY - count;
    announce = `${left} ${left === 1 ? "character" : "characters"} left`;
  }
  return { count, over, text, announce };
}

export interface BoardTargetsBody {
  hostel_ids: string[];
  all_hostels: boolean;
}

const UNKNOWN_HOSTEL = "Choose hostels from the list. Reload the page if it changed.";

/** Some hostels, or all hostels (then no ids are sent): exactly one of the two. */
export function checkTargets(ids: readonly string[], all: boolean): Checked<BoardTargetsBody> {
  if (all) return { ok: true, value: { hostel_ids: [], all_hostels: true } };
  if (ids.length === 0) return { ok: false, error: "Choose at least one hostel." };
  if (!ids.every(isUuid) || new Set(ids).size !== ids.length) {
    return { ok: false, error: UNKNOWN_HOSTEL };
  }
  if (ids.length > MAX_HOSTELS) {
    return { ok: false, error: `Choose at most ${MAX_HOSTELS} hostels, or All hostels.` };
  }
  return { ok: true, value: { hostel_ids: [...ids], all_hostels: false } };
}

/**
 * Targets a client component hands a server action (reach, draft): anything a browser could
 * send, so the shape is checked before checkTargets, and nothing else is passed on.
 */
export function targetsFrom(input: unknown): Checked<BoardTargetsBody> {
  if (typeof input !== "object" || input === null) return { ok: false, error: UNKNOWN_HOSTEL };
  const { hostel_ids: ids, all_hostels: all } = input as Record<string, unknown>;
  if (
    typeof all !== "boolean" ||
    !Array.isArray(ids) ||
    !ids.every((id): id is string => typeof id === "string")
  ) {
    return { ok: false, error: UNKNOWN_HOSTEL };
  }
  return checkTargets(ids, all);
}

/**
 * Who a new post is for when the page opens: the hostels ?draft= named, else a warden's own
 * hostels (every one of them; the picker is hidden when there is one), else nothing yet.
 */
export function startTargets(
  role: Role,
  hostels: readonly { id: string }[],
  fromDraft: BoardTargetsBody | null,
): BoardTargetsBody {
  if (fromDraft) return fromDraft;
  if (role === "warden") return { hostel_ids: hostels.map((h) => h.id), all_hostels: false };
  return { hostel_ids: [], all_hostels: false };
}

/** The confirm step's "replace_timings" choice, naming how many posts it takes down. */
export function replaceLabel(count: number): string {
  return count === 1
    ? "Take down the older timings post"
    : `Take down the ${count} older timings posts`;
}

/** What the form holds, as typed. */
export interface BoardFields {
  category: string;
  title: string;
  body: string;
  hostel_ids: string[];
  all_hostels: boolean;
  expires_in_days: string;
  replace_timings: boolean;
}

/** What POST /admin/board takes (the server sets the end time from `expires_in_days`). */
export interface BoardPostPayload extends BoardTargetsBody {
  category: BoardCategory;
  title: string;
  body: string;
  expires_in_days: ExpiryDays;
  replace_timings: boolean;
}

export function boardPost(fields: BoardFields): Checked<BoardPostPayload> {
  if (!isCategory(fields.category)) return { ok: false, error: "Choose what the post is about." };
  const targets = checkTargets(fields.hostel_ids, fields.all_hostels);
  if (!targets.ok) return targets;
  const title = checkTitle(fields.title);
  if (!title.ok) return title;
  const body = checkBody(fields.body);
  if (!body.ok) return body;
  const days = Number(fields.expires_in_days);
  if (fields.expires_in_days === "" || !isExpiry(days)) {
    return { ok: false, error: "Choose how long the post shows." };
  }
  return {
    ok: true,
    value: {
      category: fields.category,
      title: title.value,
      body: body.value,
      ...targets.value,
      expires_in_days: days,
      replace_timings: fields.category === "timings" && fields.replace_timings,
    },
  };
}

// ---------- the outing-rules draft ----------

export interface DraftText {
  title: string;
  body: string;
}

/**
 * "Use the outing rules": the draft goes into the empty fields straight away. A field that
 * already holds something else is only replaced after asking ("Replace what you wrote?").
 */
export function draftFill(
  current: DraftText,
  draft: DraftText,
): { fill: Partial<DraftText>; ask: boolean } {
  const fill: Partial<DraftText> = {};
  let ask = false;
  for (const key of ["title", "body"] as const) {
    if (current[key].trim() === "") fill[key] = draft[key];
    else if (current[key] !== draft[key]) ask = true;
  }
  return { fill, ask };
}

/**
 * The draft is back from the API, which can take a while (a cold start, or queued behind other
 * requests). The fields stay editable meanwhile, so it is checked against what they hold now,
 * not at the click. A draft for hostels that were changed in the meantime is dropped (null).
 */
export function draftArrival(
  asked: BoardTargetsBody,
  now: DraftText & { targets: BoardTargetsBody },
  draft: DraftText,
): { fill: Partial<DraftText>; ask: boolean } | null {
  if (!sameTargets(asked, now.targets)) return null;
  return draftFill({ title: now.title, body: now.body }, draft);
}

function sameTargets(a: BoardTargetsBody, b: BoardTargetsBody): boolean {
  if (a.all_hostels || b.all_hostels) return a.all_hostels === b.all_hostels;
  const ids = new Set(a.hostel_ids);
  return ids.size === new Set(b.hostel_ids).size && b.hostel_ids.every((id) => ids.has(id));
}

/**
 * /admin/board?draft=<rule set id> (the rules page's "Announce this change"): the hostels
 * following that rule set, among the ones this person posts to. None of theirs follow it:
 * All hostels for every-hostel staff, else nothing (null: the form starts empty).
 */
export function draftTargets(
  ruleSetId: string | undefined,
  hostels: readonly { id: string; rule_set_id: string }[],
  everyHostel: boolean,
): BoardTargetsBody | null {
  if (!isUuid(ruleSetId)) return null;
  const ids = hostels.filter((h) => h.rule_set_id === ruleSetId).map((h) => h.id);
  if (ids.length > 0) return { hostel_ids: ids, all_hostels: false };
  return everyHostel ? { hostel_ids: [], all_hostels: true } : null;
}

// ---------- reach, counts, status ----------

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "For 312 students, 240 phones get a notification". */
export function reachText(reach: BoardReach): string {
  if (reach.students === 0) return "No students are in these hostels yet";
  const phones =
    reach.devices === 0
      ? "no phones get a notification"
      : reach.devices === 1
        ? "1 phone gets a notification"
        : `${reach.devices} phones get a notification`;
  return `For ${plural(reach.students, "student", "students")}, ${phones}`;
}

/** Two facts, never "N of M". The server sends the seen count rounded down to a step of 5, or
 * null while fewer than 5 opened it or fewer than 5 haven't (privacy: no way to tell who). */
export function countsText(students: number, seen: number | null): string {
  const sent = `Sent to ${plural(students, "student", "students")}`;
  if (seen === null)
    return `${sent}. A seen count shows once at least 5 have opened it and 5 haven't.`;
  return `${sent}, seen by ${seen} to ${seen + 4}`;
}

export const STATUS_LABEL: Readonly<Record<BoardStatus, string>> = {
  active: "Active",
  ended: "Ended",
  withdrawn: "Withdrawn",
};

export function hostelsText(post: Pick<StaffBoardPost, "all_hostels" | "hostels">): string {
  if (post.all_hostels) return "All hostels";
  if (post.hostels.length === 0) return "Hostels since removed";
  return post.hostels.map((h) => h.name).join(", ");
}

/** Why an active post has no Withdraw button; null when it has one, or is already off. */
export function withdrawReason(
  post: Pick<StaffBoardPost, "status" | "can_withdraw" | "author">,
): string | null {
  if (post.status !== "active" || post.can_withdraw) return null;
  switch (post.author) {
    case "Head warden":
      return "Posted by the head warden";
    case "Admin":
      return "Posted by an admin";
    case "Warden":
      return "Posted by another warden";
    default:
      return "Posted by someone else";
  }
}

/**
 * The active timings posts a new timings post would take down with "Take down the older
 * timings post" (the API's rule): ones the sender may withdraw, whose every hostel the new
 * post covers. An all-hostels post covers them all.
 */
export function olderTimings(
  posts: readonly StaffBoardPost[],
  targets: BoardTargetsBody,
): StaffBoardPost[] {
  return posts.filter(
    (p) =>
      p.status === "active" &&
      p.category === "timings" &&
      p.can_withdraw &&
      (targets.all_hostels ||
        (!p.all_hostels && p.hostels.every((h) => targets.hostel_ids.includes(h.id)))),
  );
}

/** One row of the list, as text (formatted on the server, so hydration matches). */
export interface BoardRow {
  id: number;
  title: string;
  body: string;
  category: string;
  status: string;
  hostels: string;
  posted: string;
  until: string;
  counts: string;
  from: string;
  canWithdraw: boolean;
  reason: string | null;
}

export function boardRow(post: StaffBoardPost, fmt: (iso: string) => string): BoardRow {
  const until =
    post.status === "active"
      ? `Until ${fmt(post.expires_at)}`
      : post.status === "ended"
        ? `Ended ${fmt(post.expires_at)}`
        : `Taken down before ${fmt(post.expires_at)}`;
  return {
    id: post.id,
    title: post.title,
    body: post.body,
    category: CATEGORY_LABEL[post.category],
    status: STATUS_LABEL[post.status],
    hostels: hostelsText(post),
    posted: `Posted ${fmt(post.created_at)}`,
    until,
    counts: countsText(post.students, post.seen),
    from: `From: ${post.author}`,
    canWithdraw: post.status === "active" && post.can_withdraw,
    reason: withdrawReason(post),
  };
}

const MAX_POST_ID = BigInt("9223372036854775807");

/** A post id from a form, ready for a backend path: a whole number 1..2**63-1, else null. */
export function postId(raw: string): string | null {
  if (!/^[1-9][0-9]{0,18}$/.test(raw)) return null;
  return BigInt(raw) <= MAX_POST_ID ? raw : null;
}

// ---------- the form, as the server action reads it ----------

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * The post form's fields as typed (the body untrimmed: boardPost checks and trims it as the API
 * does). Checkboxes are "on" when ticked; a file where text belongs reads as empty.
 */
export function readBoardForm(form: FormData): BoardFields {
  return {
    category: formText(form, "category"),
    title: formText(form, "title"),
    body: formText(form, "body"),
    hostel_ids: form.getAll("hostel_ids").filter((v): v is string => typeof v === "string"),
    all_hostels: form.get("all_hostels") === "on",
    expires_in_days: formText(form, "expires_in_days"),
    replace_timings: form.get("replace_timings") === "on",
  };
}

/** "Posted. For 312 students, 240 phones get a notification." */
export function postedText(sent: BoardSent): string {
  return `Posted. ${reachText(sent)}.`;
}

// ---------- the rules page ----------

/**
 * The rules page's "Announce this change" for one rule set: the board form started with the
 * hostels that follow it (see draftTargets). A rule set no hostel follows reaches students only
 * as the campus default, announced to "All hostels", which only every-hostel staff send. Any
 * other unfollowed set reaches nobody, and the draft (written from the sets hostels follow)
 * wouldn't hold its timings: no link.
 */
export function announceHref(
  ruleSetId: string,
  hostelsInSet: number,
  isDefault: boolean,
  role: Role,
): string | null {
  if (!canPostToBoard(role) || !isUuid(ruleSetId)) return null;
  if (hostelsInSet === 0 && (!isDefault || !postsToAllHostels(role))) return null;
  return `/admin/board?draft=${ruleSetId}`;
}

// ---------- the student's side ----------

/** Posts on the home page; the rest are on /board. */
export const HOME_POSTS = 3;
/** POST /board/seen takes 1..30 ids (GET /board returns at most 30 posts). */
export const MAX_SEEN = 30;

/** One post as a student reads it, as text (formatted on the server, so hydration matches). */
export interface StudentRow {
  id: number;
  title: string;
  body: string;
  category: string;
  from: string;
  posted: string;
  until: string;
  /** Not seen before this view: shown as the text "New", never by colour alone. */
  isNew: boolean;
}

export function studentRow(post: BoardPost, fmt: (iso: string) => string): StudentRow {
  return {
    id: post.id,
    title: post.title,
    body: post.body,
    category: CATEGORY_LABEL[post.category],
    from: post.from_label,
    posted: `Posted ${fmt(post.created_at)}`,
    until: `Until ${fmt(post.expires_at)}`,
    isNew: !post.seen,
  };
}

/** The posts on screen the student hadn't seen: the one seen call for this view ([]: none). */
export function unseenIds(posts: readonly Pick<BoardPost, "id" | "seen">[]): number[] {
  return posts
    .filter((p) => !p.seen)
    .map((p) => p.id)
    .slice(0, MAX_SEEN);
}

/**
 * The seen action's input, checked again on the server (anyone can call a server action):
 * 1..30 whole post ids, duplicates dropped; anything else is null and nothing is sent.
 */
export function seenIds(input: unknown): number[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_SEEN) return null;
  const ids: number[] = [];
  for (const value of input) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) return null;
    if (!ids.includes(value)) ids.push(value);
  }
  return ids;
}

/** Home's link to /board, when home shows only some of the posts. */
export function seeAllText(count: number): string | null {
  return count > HOME_POSTS ? `See all ${count} posts` : null;
}

// ---------- errors ----------

/** The API's refusal in words that say what to do. Most details are written for people already. */
export function boardError(
  status: number,
  detail: string,
  action: "post" | "reach" | "draft" | "withdraw",
): string {
  if (status === 404) {
    return action === "withdraw"
      ? "That post isn't on your hostels' board any more. Reload the page."
      : "One of those hostels isn't one you look after any more. Reload the page and choose again.";
  }
  if (status === 429 && action === "post") {
    return "The board takes at most 10 posts an hour from each person. Try again later.";
  }
  return detail;
}
