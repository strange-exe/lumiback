/**
 * "Announce an update" (developers only): a push to every phone with Lumiback, or to chosen
 * roles, sent once confirmed (no daily limit since 2026-11-09). This module checks the form and
 * shapes the wording; the API enforces every rule. Pure, so `node --test` can load it.
 */

import { readableDetail } from "../../lib/api-error.ts";

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

/** The title pattern for each kind, shown as the field's example. */
export const KIND_PATTERN: Record<AnnounceKind, string> = {
  feature: "Now live: <feature>",
  fix: "Patch: <area>",
  maintenance: "Scheduled maintenance: <day>",
  notice: "<Subject> updated",
};

export const AUDIENCE_ROLES = ["student", "warden", "head_warden", "admin", "developer"] as const;
export type AudienceRole = (typeof AUDIENCE_ROLES)[number];
export type Audience = "everyone" | AudienceRole[];

const ROLE_PLURAL: Record<AudienceRole, string> = {
  student: "students",
  warden: "wardens",
  head_warden: "head wardens",
  admin: "admins",
  developer: "developers",
};

/** One sent announcement (GET /admin/announcements `history`, newest first). */
export interface AnnouncementRecord {
  at: string;
  by: string | null;
  /** null for the ones sent before kinds existed. */
  kind: AnnounceKind | null;
  title: string;
  /** Roles as the API sorts them. */
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
  /** Always null since the daily limit went (2026-11-09); kept by the API for 1.18.x apps. */
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
 * point, if that is short enough), and its kind (a notice when the entry names none). Anything
 * too long for a push starts empty rather than cut.
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

function listed(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** Who it goes to, in a sentence: "every phone with Lumiback", "wardens and head wardens". */
export function audienceLabel(audience: Audience): string {
  if (audience === "everyone") return "every phone with Lumiback";
  return listed(inOrder(audience).map((role) => ROLE_PLURAL[role]));
}

/** Who it went to, for the history table: "Everyone", "Wardens, head wardens". */
export function historyAudience(audience: "everyone" | readonly string[]): string {
  if (audience === "everyone") return "Everyone";
  const words = inOrder(audience)
    .map((role) => ROLE_PLURAL[role])
    .join(", ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
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

/**
 * The form's choices (radio `kind`, radio `audience` "everyone" | "roles", checkboxes `role`,
 * radio `image`). Anything the form can't have sent falls back to the safe choice; the roles
 * count only when "Choose roles" is picked.
 */
export function announceOptions(form: Pick<FormData, "get" | "getAll">): AnnounceOptions {
  const one = (name: string): string => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };
  const kind = one("kind");
  const roles = form.getAll("role").filter((v): v is string => typeof v === "string");
  return {
    kind: isKind(kind) ? kind : "notice",
    audience: one("audience") === "roles" ? inOrder(roles) : "everyone",
    image: one("image") || null,
  };
}

export type AnnounceBody = { ok: true; body: AnnouncePayload } | { ok: false; error: string };

/**
 * The request for the form's text and choices. Without options it is the text alone (what the
 * 1.18 form sent). A banner goes only with a feature launch, never with anything else.
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

/** The API's refusal for anyone who isn't a developer (backend api/admin.py). */
const DEVELOPERS_ONLY = "Developers only";

/**
 * What the form shows for a refusal: who may announce for "not a developer", the view-as
 * explanation when a developer is viewing as another role, otherwise the server's own words.
 */
export function announceError(status: number, detail: string): string {
  if (status === 403 && detail === DEVELOPERS_ONLY) return "Only developers can announce updates.";
  return readableDetail(status, detail);
}
