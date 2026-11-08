/**
 * "Announce an update" (developers only): a push to every phone with Lumiback, at most once a
 * day. This module checks the form and shapes the wording; the API enforces every rule. Pure,
 * so `node --test` can load it.
 */

export const MAX_ANNOUNCE_TITLE = 50;
export const MAX_ANNOUNCE_BODY = 140;

/** GET /admin/announcements */
export interface AnnounceState {
  last_at: string | null;
  /** When the next announcement is allowed; null if allowed now. */
  next_at: string | null;
}

/** POST /admin/announcements (202) */
export interface Announced {
  devices: number;
  next_at: string;
}

const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
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

/** When the last one went out, and whether (or when) the next is allowed. */
export function announceTiming(
  state: AnnounceState,
  now: number,
  fmt: (iso: string) => string,
): { last: string; next: string; allowed: boolean } {
  const last = state.last_at ? `Last announced ${fmt(state.last_at)}.` : "No update announced yet.";
  const nextAt = state.next_at ? Date.parse(state.next_at) : NaN;
  if (state.next_at && Number.isFinite(nextAt) && nextAt > now) {
    return { last, next: `You can announce again after ${fmt(state.next_at)}.`, allowed: false };
  }
  return { last, next: "You can announce now.", allowed: true };
}

export function reachedLine(devices: number): string {
  // Queued, not yet delivered: the server sends it after answering.
  if (devices <= 0) return "Announced, but no phones have the app to receive it.";
  return `Sending to ${devices} ${devices === 1 ? "phone" : "phones"}.`;
}

export function announceError(status: number, detail: string): string {
  if (status === 403) return "Only developers can announce updates.";
  return detail;
}
