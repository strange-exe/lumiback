/**
 * "Announce an update" (developers only): a push to every phone with Lumiback, sent only when a
 * developer confirms it here (no daily limit since 2026-11-09). This module checks the form and shapes the
 * wording; the API enforces every rule. Same rules and words as the website's
 * (apps/web/src/features/developer/announce.ts). Pure, so it is unit-tested.
 */
import { isDeveloperAsSelf } from "@/lib/view-as";

export const MAX_ANNOUNCE_TITLE = 50;
export const MAX_ANNOUNCE_BODY = 140;

export const ANNOUNCE_CONFIRM =
  "Send this to every phone with Lumiback? It goes out as soon as you send it.";

/** GET /admin/announcements */
export interface AnnounceState {
  last_at: string | null;
  /** Always null since the daily limit went (2026-11-09); the API keeps it for 1.18.x apps. */
  next_at: string | null;
}

/** POST /admin/announcements (200) */
export interface Announced {
  devices: number;
  next_at: string | null;
}

/** What the form starts with: the newest release's title and its one-line summary. */
export interface AnnounceDraft {
  title: string;
  body: string;
}

/**
 * The announcement for a release, ready to edit: its title, and its `summary` (or its first
 * point, if that is short enough). Anything too long for a push starts empty rather than cut.
 */
export function announceDraft(release: {
  title: string;
  summary?: string;
  points: readonly string[];
}): AnnounceDraft {
  const fits = (value: string | undefined, max: number): string =>
    value && [...value].length <= max ? value : "";
  return {
    title: fits(release.title, MAX_ANNOUNCE_TITLE),
    body: fits(release.summary, MAX_ANNOUNCE_BODY) || fits(release.points[0], MAX_ANNOUNCE_BODY),
  };
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

export type AnnounceBody =
  { ok: true; body: { title: string; body: string } } | { ok: false; error: string };

export function announceBody(rawTitle: string, rawBody: string): AnnounceBody {
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
