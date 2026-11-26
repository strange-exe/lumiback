/**
 * The hostel board: pure helpers shared by the student's board (Today card, board screen,
 * notifications) and the office's compose screen. The server (backend api/board.py and
 * schemas.py BoardTitle/BoardBody) is the authority; the checks here only mirror it so the
 * form can say what's wrong before sending.
 */
import { formatStamp } from "@/lib/time";
import type {
  BoardCategory,
  BoardPost,
  BoardPostBody,
  BoardReach,
  BoardStatus,
  Role,
  StaffBoardPost,
} from "@/lib/types";

export const BOARD_CATEGORIES: readonly { value: BoardCategory; label: string }[] = [
  { value: "timings", label: "Timings" },
  { value: "mess", label: "Mess" },
  { value: "laundry", label: "Laundry" },
  { value: "maintenance", label: "Maintenance" },
  { value: "general", label: "General" },
];

export const CATEGORY_LABEL: Record<BoardCategory, string> = {
  timings: "Timings",
  mess: "Mess",
  laundry: "Laundry",
  maintenance: "Maintenance",
  general: "General",
};

export type ExpiryDays = BoardPostBody["expires_in_days"];

/** How long a post can show (the server's expires_in_days choices). */
export const EXPIRY_DAYS: readonly ExpiryDays[] = [1, 3, 7, 30, 60];

/** The server's default when none is sent: 30 days for timings, 7 for anything else. */
export function defaultExpiry(category: BoardCategory): ExpiryDays {
  return category === "timings" ? 30 : 7;
}

export function expiryLabel(days: ExpiryDays): string {
  return days === 1 ? "1 day" : `${days} days`;
}

/** The compose form as typed (before the checks). */
export interface BoardForm {
  category: BoardCategory;
  title: string;
  body: string;
  hostelIds: string[];
  allHostels: boolean;
  expiresInDays: ExpiryDays;
  replaceTimings: boolean;
}

const TITLE_MAX = 60;
const BODY_MAX = 600;
const BODY_LINES = 20;

// Control (Cc), invisible formatting (Cf), lone surrogates (Cs) and line or paragraph
// separators (Zl, Zp), as backend _no_control_characters. ZWNJ and ZWJ are allowed: Indic
// scripts spell words with them.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
const JOINERS = new Set([0x200c, 0x200d]);
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
// Letters that show nothing (the Hangul fillers), as backend _INVISIBLE_LETTERS.
const BLANK_LETTERS = new Set([0x115f, 0x1160, 0x3164, 0xffa0]);

function hasInvisible(text: string): boolean {
  for (const ch of text) {
    if (JOINERS.has(ch.codePointAt(0) ?? 0)) continue;
    if (INVISIBLE.test(ch)) return true;
  }
  return false;
}

function hasLetterOrDigit(text: string): boolean {
  for (const ch of text) {
    if (LETTER_OR_DIGIT.test(ch) && !BLANK_LETTERS.has(ch.codePointAt(0) ?? 0)) return true;
  }
  return false;
}

/** Characters as the server counts them (code points: an emoji is one). */
function length(text: string): number {
  return [...text].length;
}

/** What POST /admin/board takes, from the form as it is (see checkPost for the checks). */
export function postBody(form: BoardForm): BoardPostBody {
  return {
    category: form.category,
    title: form.title,
    body: form.body,
    hostel_ids: form.allHostels ? [] : form.hostelIds,
    all_hostels: form.allHostels,
    expires_in_days: form.expiresInDays,
    // Taking down older timings posts only means something for a timings post.
    replace_timings: form.category === "timings" && form.replaceTimings,
  };
}

export type PostCheck = { ok: true; body: BoardPostBody } | { ok: false; error: string };

/** The server's checks, in its words for a person: the first problem, or the body to send. */
export function checkPost(form: BoardForm): PostCheck {
  // Control characters are refused before trimming, as on the server (a trailing line break
  // in a title is still a line break).
  if (hasInvisible(form.title)) {
    return { ok: false, error: "Write the title as one line of plain text." };
  }
  const title = form.title.trim();
  if (!title) return { ok: false, error: "Add a title." };
  if (length(title) > TITLE_MAX) return { ok: false, error: "Keep the title to 60 characters." };
  if (!hasLetterOrDigit(title)) return { ok: false, error: "Give the title a word or number." };

  const lines = form.body.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (hasInvisible(lines.replace(/\n/g, ""))) {
    return { ok: false, error: "Use plain text: no tabs or hidden characters." };
  }
  const body = lines.trim();
  if (!body) return { ok: false, error: "Write the post." };
  if (length(body) > BODY_MAX) return { ok: false, error: "Keep it to 600 characters." };
  if (body.includes("\n\n\n")) {
    return { ok: false, error: "Leave at most one blank line in a row." };
  }
  if (body.split("\n").length > BODY_LINES) return { ok: false, error: "Keep it to 20 lines." };

  if (!form.allHostels && form.hostelIds.length === 0) {
    return { ok: false, error: "Choose a hostel, or all hostels." };
  }
  return { ok: true, body: postBody({ ...form, title, body }) };
}

/** The query naming who a post is for (reach and draft), or null when nobody is chosen. */
export function targetQuery(target: { hostelIds: string[]; allHostels: boolean }): string | null {
  if (target.allHostels) return "all_hostels=true";
  if (target.hostelIds.length === 0) return null;
  return target.hostelIds.map((id) => `hostel_ids=${encodeURIComponent(id)}`).join("&");
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "For 312 students, 240 phones get a notification" */
export function reachLine(reach: { students: number; devices: number }): string {
  const verb = reach.devices === 1 ? "gets" : "get";
  return `For ${plural(reach.students, "student", "students")}, ${plural(reach.devices, "phone", "phones")} ${verb} a notification`;
}

/** Two facts, never "N of M". The server sends the seen count rounded down to a step of 5,
 * or null while fewer than 5 opened it or fewer than 5 haven't (privacy: no way to tell who). */
export function seenLine(post: { students: number; seen: number | null }): string {
  const sent = `Sent to ${plural(post.students, "student", "students")}`;
  if (post.seen === null)
    return `${sent}. A seen count shows once at least 5 have opened it and 5 haven't.`;
  return `${sent}, seen by ${post.seen} to ${post.seen + 4}`;
}

export const STATUS_LABEL: Record<BoardStatus, string> = {
  active: "Active",
  ended: "Ended",
  withdrawn: "Withdrawn",
};

const POSTED_BY: Record<string, string> = {
  "Head warden": "Posted by the head warden",
  Warden: "Posted by another warden",
  Admin: "Posted by an admin",
  Developer: "Posted by a developer",
};

/** Why an active post has no Withdraw button (null when it has one, or isn't up). */
export function withdrawMissing(post: {
  author: string;
  status: BoardStatus;
  can_withdraw: boolean;
}): string | null {
  if (post.can_withdraw || post.status !== "active") return null;
  return (
    POSTED_BY[post.author] ??
    "Only the person who posted it, a head warden or an admin can take it down"
  );
}

/** The office's "Post to the hostel board" row: how many posts are up, when known. */
export function boardRowDetail(active: number | undefined): string {
  if (active === undefined) return "Timings, mess, laundry: every student in your hostels sees it";
  if (active === 0) return "Nothing on the board right now";
  return plural(active, "active post", "active posts");
}

/** The older feature ("notice" to students who are out), named by its audience. */
export const OUT_NOTICE = {
  title: "Message students who are out",
  detail:
    "Urgent: a notification now (or email). For things every student should see, post to the hostel board.",
  placeholder: "Heavy rain near Clock Tower. Take a cab back.",
} as const;

export const BOARD_HINT = "Board posts go to every student in the hostel: don't name students.";

/**
 * "Use the outing rules": fills the empty fields without asking. When the body already has
 * words, `asks` is true and the values are what replacing would give (ask "Replace what you
 * wrote?" first).
 */
export function draftFill(
  current: { title: string; body: string },
  draft: { title: string; body: string },
): { asks: boolean; title: string; body: string } {
  if (current.body.trim()) return { asks: true, title: draft.title, body: draft.body };
  return {
    asks: false,
    title: current.title.trim() ? current.title : draft.title,
    body: draft.body,
  };
}

/**
 * "Tell students" after adding a holiday: the compose screen's params, or null for someone
 * who can't post to every hostel (holidays are campus-wide; developers never post).
 */
export function holidayCompose(
  day: string,
  role: Role | undefined,
): { holiday: string; all: "1" } | null {
  if (role !== "head_warden" && role !== "admin") return null;
  return { holiday: day, all: "1" };
}

/** "Until Tue 1 Dec, 9:00 AM" (campus time). */
export function untilLine(post: Pick<BoardPost, "expires_at">): string {
  return `Until ${formatStamp(post.expires_at)}`;
}

/** One post read aloud: "New" is said, never only shown in colour. */
export function postA11yLabel(post: BoardPost, isNew: boolean): string {
  return [
    isNew ? "New" : null,
    post.title,
    CATEGORY_LABEL[post.category],
    `From ${post.from_label}`,
    `Posted ${formatStamp(post.created_at)}`,
    untilLine(post),
  ]
    .filter(Boolean)
    .join(". ");
}

/**
 * Whether enough of a card is in view to count as read: half of it, or half the screen for a
 * card taller than that. `top`: the card's offset in the scrolled content.
 */
export function cardOnScreen(v: {
  top: number;
  height: number;
  scrollY: number;
  viewport: number;
}): boolean {
  if (v.height <= 0 || v.viewport <= 0) return false;
  const shown = Math.min(v.top + v.height, v.scrollY + v.viewport) - Math.max(v.top, v.scrollY);
  return shown >= Math.min(v.height, v.viewport) / 2;
}

/** POST /board/seen takes 1 to 30 ids. */
const SEEN_MAX = 30;

/** The posts not seen yet, to mark (at most what the server takes in one call). */
export function unseenIds(posts: readonly BoardPost[]): number[] {
  return posts
    .filter((p) => !p.seen)
    .map((p) => p.id)
    .slice(0, SEEN_MAX);
}

const TAG = /^board:([1-9][0-9]{0,15})$/;
// expo-notifications 57.0.25 (ExpoPresentationDelegate.kt getInternalIdentifierKey) names a
// notification it didn't draw itself like this, with the Android tag in the query.
const FOREIGN = "expo-notifications://foreign_notifications?";

function tagFromForeign(identifier: string): string | null {
  if (!identifier.startsWith(FOREIGN)) return null;
  for (const pair of identifier.slice(FOREIGN.length).split("&")) {
    if (!pair.startsWith("tag=")) continue;
    try {
      return decodeURIComponent(pair.slice("tag=".length));
    } catch {
      return null; // not valid percent-encoding
    }
  }
  return null;
}

/**
 * The board post a notification is for, from its identifier: "board:<id>" (the push's tag,
 * kept when the app drew it) or the foreign-notification shape. Null for anything else.
 */
export function boardTagId(identifier: string): number | null {
  const tag = TAG.test(identifier) ? identifier : tagFromForeign(identifier);
  const match = tag ? TAG.exec(tag) : null;
  if (!match?.[1]) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) ? id : null;
}

/** Where a tapped board push opens the board: its post id, else its title, else nothing. */
export function boardTapParams(
  identifier: string,
  title: string | null | undefined,
): { post?: string; title?: string } {
  const id = boardTagId(identifier);
  if (id !== null) return { post: String(id) };
  const text = title?.trim();
  if (!text) return {};
  return { title: [...text].slice(0, TITLE_MAX).join("") };
}

/** A notification in the shade, as notify.ts reads it. */
export interface ShownNotification {
  identifier: string;
  title: string | null;
  url: string | null;
  /** When it was shown, in ms on this phone's clock. */
  date: number;
}

/**
 * The board notifications in the shade whose post is no longer up (ended or taken down).
 * A notification Android kept no tag for is matched by its title. `asked`: when the board in
 * `active` was asked for (ms, this phone's clock); a notification shown since then may be for
 * a post newer than that answer, so it is left for the next load to judge.
 */
export function staleBoardNotifications(
  shown: readonly ShownNotification[],
  active: readonly BoardPost[],
  asked: number,
): string[] {
  const ids = new Set(active.map((p) => p.id));
  const titles = new Set(active.map((p) => p.title));
  const stale: string[] = [];
  for (const n of shown) {
    if (n.date >= asked) continue;
    const id = boardTagId(n.identifier);
    if (id !== null) {
      if (!ids.has(id)) stale.push(n.identifier);
    } else if (n.url === "/today/board" && !(n.title !== null && titles.has(n.title))) {
      stale.push(n.identifier);
    }
  }
  return stale;
}

export const GONE_FROM_BOARD =
  "This post is no longer on the board. The hostel office took it down or it ended.";

/** Opened from a push: whether its post is gone. Unknown (no or odd params) is not gone. */
export function goneFromBoard(
  params: { post?: string; title?: string },
  posts: readonly BoardPost[],
): boolean {
  if (params.post !== undefined) {
    if (!/^[1-9][0-9]{0,15}$/.test(params.post)) return false;
    const id = Number(params.post);
    return !posts.some((p) => p.id === id);
  }
  if (params.title) return !posts.some((p) => p.title === params.title);
  return false;
}

// ---------- the office: compose ----------

const DAY_MS = 24 * 60 * 60 * 1000;

/** "Shows until Wed 2 Dec, 10:30 AM": `days` from now, in campus time (the server sets it). */
export function untilText(days: number, now: Date = new Date()): string {
  return `Shows until ${formatStamp(new Date(now.getTime() + days * DAY_MS))}`;
}

/** The counter starts speaking this many characters before the limit. */
const ANNOUNCE_FROM = BODY_MAX - 60;

export interface BodyCounter {
  count: number;
  over: boolean;
  /** Always shown: "120 of 600 characters". */
  text: string;
  /** For a screen reader: empty until the body is near the limit. */
  announce: string;
}

/** The body's length as the server counts it (LF line breaks, trimmed, code points). */
export function bodyCounter(raw: string): BodyCounter {
  const count = length(raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim());
  const over = count > BODY_MAX;
  const extra = count - BODY_MAX;
  const text = over
    ? `${count} of ${BODY_MAX} characters: ${extra} too many`
    : `${count} of ${BODY_MAX} characters`;
  let announce = "";
  if (over) announce = `${plural(extra, "character", "characters")} too many`;
  else if (count >= ANNOUNCE_FROM) {
    announce = `${plural(BODY_MAX - count, "character", "characters")} left`;
  }
  return { count, over, text, announce };
}

/** The confirm step's replace_timings choice, naming how many posts it takes down. */
export function replaceLabel(count: number): string {
  return count === 1
    ? "Take down the older timings post"
    : `Take down the ${count} older timings posts`;
}

/** Who a post is for, as the form holds it. */
export interface BoardTarget {
  hostelIds: string[];
  allHostels: boolean;
}

/**
 * The active timings posts a new timings post would take down with replace_timings (the
 * server's rule): ones the sender may withdraw whose every hostel the new post covers. An
 * all-hostels post covers them all; a post whose hostels were all removed is covered by any.
 */
export function olderTimings(
  posts: readonly StaffBoardPost[],
  target: BoardTarget,
): StaffBoardPost[] {
  return posts.filter(
    (p) =>
      p.status === "active" &&
      p.category === "timings" &&
      p.can_withdraw &&
      (target.allHostels ||
        (!p.all_hostels && p.hostels.every((h) => target.hostelIds.includes(h.id)))),
  );
}

/**
 * How the form picks hostels: "none" (nobody to post for: a warden with no hostels, or
 * someone who can't post), "one" (a warden's only hostel, no picker), "several" (a warden's
 * hostels to tick), "every" (head wardens and admins: every hostel, or All hostels).
 */
export type HostelPicker = "none" | "one" | "several" | "every";

export function hostelPicker(role: Role | undefined, hostels: number): HostelPicker {
  if (role === "head_warden" || role === "admin") return "every";
  if (role !== "warden" || hostels === 0) return "none";
  return hostels === 1 ? "one" : "several";
}

/**
 * Where the form starts: a warden on every hostel they look after; head wardens and admins on
 * All hostels when the link asks for it (a holiday), else on nothing chosen yet.
 */
export function startTarget(
  role: Role | undefined,
  hostels: readonly { id: string }[],
  wantsAll: boolean,
): BoardTarget {
  if (role === "warden") return { hostelIds: hostels.map((h) => h.id), allHostels: false };
  const every = role === "head_warden" || role === "admin";
  return { hostelIds: [], allHostels: every && wantsAll };
}

export function toggleHostel(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

type Param = string | string[] | undefined;

function firstParam(value: Param): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The compose screen's link: a holiday to draft ("YYYY-MM-DD") and all hostels ("1"). */
export function composeParams(params: { holiday?: Param; all?: Param }): {
  holiday: string | null;
  all: boolean;
} {
  const holiday = firstParam(params.holiday);
  return {
    holiday: holiday && /^\d{4}-\d{2}-\d{2}$/.test(holiday) ? holiday : null,
    all: firstParam(params.all) === "1",
  };
}

/** "Posted. For 312 students, 240 phones get a notification." */
export function postedLine(sent: BoardReach): string {
  return `Posted. ${reachLine(sent)}.`;
}

/** The server's refusal in words that say what to do; most details are written for people. */
export function boardError(
  status: number,
  detail: string,
  action: "post" | "reach" | "draft" | "withdraw",
): string {
  if (status === 404) {
    return action === "withdraw"
      ? "That post isn't on your hostels' board any more. Pull down to refresh."
      : "One of those hostels isn't one you look after any more. Go back and choose again.";
  }
  if (status === 429 && action === "post") {
    return "The board takes at most 10 posts an hour from each person. Try again later.";
  }
  return detail || "Something went wrong. Try again.";
}

// ---------- the office: the list ----------

export function activeCount(posts: readonly Pick<StaffBoardPost, "status">[]): number {
  return posts.filter((p) => p.status === "active").length;
}

export function hostelsLine(post: Pick<StaffBoardPost, "all_hostels" | "hostels">): string {
  if (post.all_hostels) return "All hostels";
  if (post.hostels.length === 0) return "Hostels since removed";
  return post.hostels.map((h) => h.name).join(", ");
}

/** Who posted it, by role: never a name. */
export function authorLine(author: StaffBoardPost["author"]): string {
  if (author === "You") return "Posted by you";
  return POSTED_BY[author] ?? "Posted by the hostel office";
}

export function withdrawPrompt(title: string): { title: string; message: string } {
  return {
    title: `Take down "${title}"?`,
    message:
      "Students stop seeing it straight away. It stays in this list as Withdrawn, and it can't be put back.",
  };
}
