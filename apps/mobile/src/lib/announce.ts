/**
 * "Announce an update" (developers only): a push to every phone with Lumiback, sent only when a
 * developer confirms it here (no daily limit since 2026-11-09). This module checks the form and shapes the
 * wording; the API enforces every rule. Same rules and words as the website's
 * (apps/web/src/features/developer/announce.ts). Pure, so it is unit-tested.
 */
import { isDeveloperAsSelf } from "@/lib/view-as";

export const MAX_ANNOUNCE_TITLE = 50;
export const MAX_ANNOUNCE_BODY = 140;
/** Titles past this are cut short in some phones' notification shade (v2 writing standard). */
export const BEST_TITLE = 40;

/** What the announcement is (v2 writing standard); the kind lives in the title's prefix. */
export const ANNOUNCE_KINDS = ["feature", "fix", "maintenance", "notice"] as const;
export type AnnounceKind = (typeof ANNOUNCE_KINDS)[number];

export const KIND_LABEL: Record<AnnounceKind, string> = {
  feature: "Release",
  fix: "Patch",
  maintenance: "Maintenance",
  notice: "Staff notice",
};

export const KIND_PATTERN: Record<AnnounceKind, string> = {
  feature: "Now live: <feature>",
  fix: "Patch: <area>",
  maintenance: "Scheduled maintenance: <day>",
  notice: "<Subject> updated",
};

export const AUDIENCE_ROLES = ["student", "warden", "head_warden", "admin", "developer"] as const;
export type AudienceRole = (typeof AUDIENCE_ROLES)[number];
export type Audience = "everyone" | AudienceRole[];

export const ROLE_LABEL: Record<AudienceRole, string> = {
  student: "Students",
  warden: "Wardens",
  head_warden: "Head wardens",
  admin: "Admins",
  developer: "Developers",
};

/** The confirm step's question, naming who gets it. */
export function announceConfirm(audience: Audience): string {
  return `Send this to ${audienceLabel(audience)}? It goes out as soon as you send it.`;
}

export const ANNOUNCE_CONFIRM = announceConfirm("everyone");

/** One sent announcement (GET /admin/announcements `history`, newest first). */
export interface AnnouncementRecord {
  at: string;
  by: string | null;
  kind: AnnounceKind | null;
  title: string;
  audience: "everyone" | string[];
  devices: number | null;
  image: string | null;
}

/** A banner picture the website serves, for feature launches. */
export interface Banner {
  name: string;
  url: string;
}

/** GET /admin/announcements */
export interface AnnounceState {
  last_at: string | null;
  /** Always null since the daily limit went (2026-11-09); the API keeps it for 1.18.x apps. */
  next_at: string | null;
  /** Older APIs leave these out. */
  history?: AnnouncementRecord[];
  banners?: Banner[];
}

/** POST /admin/announcements (200) */
export interface Announced {
  devices: number;
  next_at: string | null;
}

/** What the form starts with: the newest release's title, its one-line summary and kind. */
export interface AnnounceDraft {
  title: string;
  body: string;
  kind: AnnounceKind;
}

function isKind(value: string | undefined): value is AnnounceKind {
  return (ANNOUNCE_KINDS as readonly string[]).includes(value ?? "");
}

/**
 * The announcement for a release, ready to edit: its title, and its `summary` (or its first
 * point, if that is short enough), and its kind (a notice when it names none). Anything too
 * long for a push starts empty rather than cut.
 */
export function announceDraft(release: {
  title: string;
  summary?: string;
  kind?: string;
  points: readonly string[];
}): AnnounceDraft {
  const fits = (value: string | undefined, max: number): string =>
    value && [...value].length <= max ? value : "";
  return {
    title: fits(release.title, MAX_ANNOUNCE_TITLE),
    body: fits(release.summary, MAX_ANNOUNCE_BODY) || fits(release.points[0], MAX_ANNOUNCE_BODY),
    kind: isKind(release.kind) ? release.kind : "notice",
  };
}

/** The title's length against the 40 that shows in full and the 50 the API takes. */
export function titleGuidance(title: string): string {
  const n = [...title.trim()].length;
  if (n === 0) return `Best under ${BEST_TITLE} characters (up to ${MAX_ANNOUNCE_TITLE}).`;
  if (n <= BEST_TITLE) {
    return `${n} characters. Best under ${BEST_TITLE} (up to ${MAX_ANNOUNCE_TITLE}).`;
  }
  return `${n} characters: over ${BEST_TITLE}, so some phones may cut it short.`;
}

function inOrder(roles: readonly string[]): AudienceRole[] {
  return AUDIENCE_ROLES.filter((role) => roles.includes(role));
}

/** Who it goes to, in a sentence: "every phone with Lumiback", "wardens and head wardens". */
export function audienceLabel(audience: Audience): string {
  if (audience === "everyone") return "every phone with Lumiback";
  const words = inOrder(audience).map((role) => ROLE_LABEL[role].toLowerCase());
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** Who it went to, for the history: "Everyone", "Wardens, head wardens". */
export function historyAudience(audience: "everyone" | readonly string[]): string {
  if (audience === "everyone") return "Everyone";
  const words = inOrder(audience)
    .map((role) => ROLE_LABEL[role].toLowerCase())
    .join(", ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Only a developer as themselves: never another role, never while viewing as one. */
export const canAnnounce = isDeveloperAsSelf;

// Control, format (invisible), surrogate and line/paragraph separator characters.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
// Indic scripts spell real words with the zero-width non-joiner and joiner (the API allows them).
const JOINERS = new Set([String.fromCodePoint(0x200c), String.fromCodePoint(0x200d)]);

function plainLine(value: string): boolean {
  return ![...value].some((c) => INVISIBLE.test(c) && !JOINERS.has(c));
}

/** What POST /admin/announcements takes. */
export interface AnnouncePayload {
  title: string;
  body: string;
  kind?: AnnounceKind;
  audience?: Audience;
  /** A banner's name; feature launches only. */
  image?: string;
}

export interface AnnounceOptions {
  kind: AnnounceKind;
  audience: Audience;
  image: string | null;
}

export type AnnounceBody = { ok: true; body: AnnouncePayload } | { ok: false; error: string };

/**
 * The request for the form's text and choices. Without options it is the text alone (what the
 * 1.18 app sent). A banner goes only with a feature launch, never with anything else.
 */
export function announceBody(
  rawTitle: string,
  rawBody: string,
  options?: AnnounceOptions,
): AnnounceBody {
  const text = announceText(rawTitle, rawBody);
  if (!text.ok || !options) return text;
  const { kind, audience, image } = options;
  if (audience !== "everyone" && audience.length === 0) {
    return { ok: false, error: "Choose at least one role, or Everyone." };
  }
  const body: AnnouncePayload = {
    ...text.body,
    kind,
    audience: audience === "everyone" ? audience : inOrder(audience),
  };
  if (kind === "feature" && image) body.image = image;
  return { ok: true, body };
}

function announceText(rawTitle: string, rawBody: string): AnnounceBody {
  const title = rawTitle.trim();
  const body = rawBody.trim();
  if (!title) return { ok: false, error: "Add a title." };
  if (!body) return { ok: false, error: "Add a line about the update." };
  if (!plainLine(title)) return { ok: false, error: "Write the title as one line of plain text." };
  if (!plainLine(body)) return { ok: false, error: "Write the line as one line of plain text." };
  if ([...title].length > MAX_ANNOUNCE_TITLE) {
    return { ok: false, error: `Keep the title to ${MAX_ANNOUNCE_TITLE} characters.` };
  }
  if ([...body].length > MAX_ANNOUNCE_BODY) {
    return { ok: false, error: `Keep the line to ${MAX_ANNOUNCE_BODY} characters.` };
  }
  return { ok: true, body: { title, body } };
}

/** When the last one went out. There is no daily limit any more, so `next_at` is ignored. */
export function announceTiming(state: AnnounceState, fmt: (iso: string) => string): string {
  return state.last_at ? `Last announced ${fmt(state.last_at)}.` : "No update announced yet.";
}

export function reachedLine(devices: number): string {
  // Queued, not yet delivered: the server sends it after answering.
  if (devices <= 0) return "Announced, but no phones have the app to receive it.";
  return `Sending to ${devices} ${devices === 1 ? "phone" : "phones"}.`;
}

/** The server's refusal (403 developers only, 503 no push on the server) as it gave it. */
export function announceError(_status: number, detail: string): string {
  return detail.trim() || "Something went wrong. Try again.";
}
