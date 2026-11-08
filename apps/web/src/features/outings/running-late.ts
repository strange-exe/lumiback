/**
 * "Running late?": a student who is out moves their due-back time once per outing, by 15, 30
 * or 60 minutes, with an optional reason for the hostel office. The server decides what can be
 * chosen now (running_late_choices) and enforces every rule; this module only shapes the
 * wording and checks the form before it is sent. Pure, so `node --test` can load it.
 */

import { formatTime, istIso } from "./time.ts";

export type LateMinutes = 15 | 30 | 60;

const ALLOWED: readonly LateMinutes[] = [15, 30, 60];

/** As the API's limit on the reason. */
export const MAX_LATE_REASON = 120;

function isLateMinutes(value: number): value is LateMinutes {
  return (ALLOWED as readonly number[]).includes(value);
}

/** What the student can choose now, in order; [] means no control is shown. */
export function lateChoices(choices: readonly number[] | null | undefined): LateMinutes[] {
  const offered = new Set(choices ?? []);
  return ALLOWED.filter((m) => offered.has(m));
}

/** A submitted choice: 15, 30 or 60, else null. */
export function lateMinutes(raw: string): LateMinutes | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return isLateMinutes(value) ? value : null;
}

/** The due time after moving it by `minutes`, as an IST ISO string. */
export function movedDue(dueIso: string, minutes: number): string {
  return istIso(Date.parse(dueIso) + minutes * 60_000);
}

const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
// Indic scripts spell real words with the zero-width non-joiner and joiner (as the API allows).
const JOINERS = new Set([String.fromCodePoint(0x200c), String.fromCodePoint(0x200d)]);

export type LateReason = { ok: true; value: string | null } | { ok: false; error: string };

/** The optional reason: one plain line, at most 120 characters; blank is null. */
export function lateReason(raw: string): LateReason {
  const value = raw.trim();
  if (!value) return { ok: true, value: null };
  const chars = [...value];
  if (chars.some((c) => INVISIBLE.test(c) && !JOINERS.has(c))) {
    return { ok: false, error: "Write the reason as one line of plain text." };
  }
  if (chars.length > MAX_LATE_REASON) {
    return { ok: false, error: `Keep the reason to ${MAX_LATE_REASON} characters.` };
  }
  return { ok: true, value };
}

/** "Due back 10:00 PM, was 9:30 PM"; just "Due back 9:30 PM" if it never moved; null with no time. */
export function dueLine(
  due: string | null | undefined,
  original: string | null | undefined,
): string | null {
  if (!due) return null;
  return original
    ? `Due back ${formatTime(due)}, was ${formatTime(original)}`
    : `Due back ${formatTime(due)}`;
}

/** The confirm step: the new time, and that it can't be done twice. */
export function confirmLine(dueIso: string, minutes: number): string {
  return `You'll be due back at ${formatTime(movedDue(dueIso, minutes))} instead of ${formatTime(dueIso)}. You can only do this once per outing.`;
}

/** Not out reads plainly; every other refusal (409, 422) is the server's own explanation. */
export function runningLateError(status: number, detail: string): string {
  if (status === 404) return "You're not checked out, so there's nothing to move. Reload the page.";
  return detail;
}

export interface RunningLateFields {
  original_return_at?: string | null;
  running_late_minutes?: number | null;
  running_late_reason?: string | null;
}

/** For the hostel office: "Running late: 30 min more, was due 9:30 PM", and the reason. */
export function officeLateNote(
  outing: RunningLateFields,
  fmt: (iso: string) => string,
): { moved: string; reason: string | null } | null {
  if (!outing.original_return_at) return null;
  const more = outing.running_late_minutes ? `${outing.running_late_minutes} min more, ` : "";
  return {
    moved: `Running late: ${more}was due ${fmt(outing.original_return_at)}`,
    reason: outing.running_late_reason || null,
  };
}
