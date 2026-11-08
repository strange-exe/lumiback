/**
 * "Running late?": a student who is out moves their due-back time once per outing, by 15, 30
 * or 60 minutes, with an optional reason for the hostel office. The server decides what can be
 * chosen now (running_late_choices) and checks every rule; this module only shapes the wording
 * and checks the form before it is sent. Same rules and words as the website's
 * (apps/web/src/features/outings/running-late.ts). Pure, so it is unit-tested.
 */
import { formatMinutes, formatTime } from "@/lib/time";

export type LateMinutes = 15 | 30 | 60;

const ALLOWED: readonly LateMinutes[] = [15, 30, 60];

/** As the API's limit on the reason. */
export const MAX_LATE_REASON = 120;

/** What the student can choose now, in order; [] means no control is shown. */
export function lateChoices(choices: readonly number[] | null | undefined): LateMinutes[] {
  const offered = new Set(Array.isArray(choices) ? choices : []);
  return ALLOWED.filter((m) => offered.has(m));
}

// Control, format (invisible), surrogate and line/paragraph separator characters.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
// Indic scripts spell real words with the zero-width non-joiner and joiner (the API allows them).
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

export interface RunningLateBody {
  minutes: LateMinutes;
  reason: string | null;
}

/** POST /outings/current/running-late's body, or what's wrong with the form. */
export function runningLateBody(
  minutes: LateMinutes,
  reason: string,
): { body: RunningLateBody } | { error: string } {
  const checked = lateReason(reason);
  if (!checked.ok) return { error: checked.error };
  return { body: { minutes, reason: checked.value } };
}

/** The due time after moving it by `minutes`, as an ISO string. */
export function movedDue(dueIso: string, minutes: number): string {
  return new Date(Date.parse(dueIso) + minutes * 60_000).toISOString();
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

/** A choice's label: "15 min", "1 h". */
export function choiceLabel(minutes: LateMinutes): string {
  return formatMinutes(minutes);
}

/** Not out reads plainly; every other refusal (409, 422, 403) is the server's own words. */
export function runningLateError(status: number, detail: string): string {
  if (status === 404) {
    return "You're not out right now, so there's nothing to move. Pull down to refresh.";
  }
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
