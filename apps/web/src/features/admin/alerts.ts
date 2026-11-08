/**
 * The hostel office's side of alerts: help requests, following up an escalation (claims and
 * calls), notices to students who are out, and the follow-up timings in Settings. The API
 * checks all of this again; these give the office a plain message first and keep the pages'
 * wording in one place. Pure, so `node --test` can load it.
 */

import { isUuid } from "../../lib/ids.ts";
import type { Role } from "../../lib/types.ts";

// ---------- links ----------

/** 5 decimal places is about a metre: enough for a map pin. */
function coordinate(value: number): number {
  return Number(value.toFixed(5));
}

/** An OpenStreetMap link to one point; null when there is no real point to show. */
export function osmLink(lat: number | null, lng: number | null): string | null {
  if (lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const y = coordinate(lat);
  const x = coordinate(lng);
  return `https://www.openstreetmap.org/?mlat=${y}&mlon=${x}#map=17/${y}/${x}`;
}

/** "within 12 m", "within 1.5 km". */
export function accuracyText(metres: number | null): string {
  if (metres === null || !Number.isFinite(metres)) return "accuracy unknown";
  if (metres >= 1000) return `within ${Number((metres / 1000).toFixed(1))} km`;
  return `within ${Math.max(1, Math.round(metres))} m`;
}

/** A tap-to-call link: only digits and a leading plus reach the href. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

// ---------- short text (call notes, notices) ----------

export const MAX_SHORT_TEXT = 200;

const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
// Indic scripts spell real words with the zero-width non-joiner and joiner (as the API allows).
const JOINERS = new Set([String.fromCodePoint(0x200c), String.fromCodePoint(0x200d)]);

export type ShortText = { ok: true; value: string | null } | { ok: false; error: string };

/**
 * One line of plain text, at most 200 characters, as the API's ShortText: no control or
 * invisible formatting characters. Empty means none. `what` names it in the message.
 */
export function shortText(raw: string, what: string): ShortText {
  const value = raw.trim();
  if (!value) return { ok: true, value: null };
  if ([...value].some((c) => INVISIBLE.test(c) && !JOINERS.has(c))) {
    return { ok: false, error: `Write the ${what} as one line of plain text.` };
  }
  if (value.length > MAX_SHORT_TEXT) {
    return { ok: false, error: `Keep the ${what} under ${MAX_SHORT_TEXT} characters.` };
  }
  return { ok: true, value };
}

// ---------- escalations: claims and calls ----------

export const CALL_OUTCOMES = [
  "reached_student",
  "reached_contact",
  "no_answer",
  "left_message",
] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const OUTCOME_LABELS: Readonly<Record<CallOutcome, string>> = {
  reached_student: "Reached the student",
  reached_contact: "Reached their emergency contact",
  no_answer: "No answer",
  left_message: "Left a message",
};

export function isCallOutcome(value: unknown): value is CallOutcome {
  return typeof value === "string" && (CALL_OUTCOMES as readonly string[]).includes(value);
}

export function callBody(
  outcome: string,
  note: string,
): { body: { outcome: CallOutcome; note: string | null } } | { error: string } {
  if (!isCallOutcome(outcome)) return { error: "Choose how the call went." };
  const checked = shortText(note, "note");
  if (!checked.ok) return { error: checked.error };
  return { body: { outcome, note: checked.value } };
}

/**
 * Who sees "Give back": whoever has it, and a head warden or admin when someone else has it
 * (to free one left claimed by someone who went off shift). The API decides again.
 */
export function canGiveBack(
  escalation: { claimed_by: string | null; claimed_by_me: boolean },
  role: Role,
): boolean {
  if (escalation.claimed_by_me) return true;
  if (escalation.claimed_by === null) return false;
  return role === "head_warden" || role === "admin" || role === "developer";
}

// ---------- notices ----------

export interface NoticeBody {
  message: string;
  recall: boolean;
  hostel_id: string | null;
}

export function noticeBody(
  message: string,
  recall: boolean,
  hostelId: string,
): { body: NoticeBody } | { error: string } {
  const checked = shortText(message, "message");
  if (!checked.ok) return { error: checked.error };
  if (checked.value === null) return { error: "Write the notice first." };
  if (hostelId && !isUuid(hostelId)) return { error: "Choose a hostel from the list." };
  return { body: { message: checked.value, recall, hostel_id: hostelId || null } };
}

export function noticeResult(sent: number): string {
  if (sent === 0) return "No one is out right now, so nobody was sent it.";
  return `Sent to ${sent} ${sent === 1 ? "student" : "students"}.`;
}

// ---------- follow-up timings (Settings) ----------

export const TIMING_FIELDS = [
  {
    name: "request_remind_minutes",
    label: "Remind wardens about a waiting request after (minutes)",
    hint: "Counted from when the student asked.",
    fallback: 15,
  },
  {
    name: "request_backup_minutes",
    label: "Tell head wardens a request is still waiting after (minutes)",
    hint: "Counted from when the student asked. Head wardens can decide any hostel's request.",
    fallback: 30,
  },
  {
    name: "escalation_realert_minutes",
    label: "Alert the office again about a late student every (minutes)",
    hint: "Until someone in the office says they're on it.",
    fallback: 15,
  },
  {
    name: "escalation_takeover_minutes",
    label: "Hand a late student to the head wardens after (minutes)",
    hint: "If nobody in the office has said they're on it by then.",
    fallback: 30,
  },
] as const;

export type TimingName = (typeof TIMING_FIELDS)[number]["name"];

const WHOLE_MINUTES = /^\d{1,3}$/;

export function readTimings(
  typed: Readonly<Record<TimingName, string>>,
): { ok: true; values: Record<TimingName, number> } | { ok: false; error: string } {
  const values = {} as Record<TimingName, number>;
  for (const { name } of TIMING_FIELDS) {
    const raw = typed[name].trim();
    const minutes = WHOLE_MINUTES.test(raw) ? Number(raw) : Number.NaN;
    if (!(minutes >= 5 && minutes <= 240)) {
      return { ok: false, error: "Follow-up timings are whole minutes from 5 to 240." };
    }
    values[name] = minutes;
  }
  return { ok: true, values };
}
