import type { Correction, CorrectionKind, InVia, Outing } from "../../lib/types.ts";
import { formatDay, formatTime, istInputToIso } from "./time.ts";

/**
 * Outing corrections, as students and the hostel office see them. The backend decides
 * (backend/app/services/corrections.py); these only choose what to offer and how to say it.
 * Nothing here reads the clock: callers pass the server's request time.
 */

/** A student can ask about their open outing, or one that ended this recently. */
export const STUDENT_CAN_ASK_DAYS = 7;
const DAY_MS = 86_400_000;

/** The office cancelled it: the tap was a mistake and there was no trip. */
export function isCancelled(outing: Pick<Outing, "correction">): boolean {
  const c = outing.correction;
  return c?.kind === "cancel" && c.status === "approved";
}

/** Whether "Something wrong?" is offered: open or recently ended, and nothing already asked. */
export function canAsk(outing: Outing, nowMs: number): boolean {
  if (outing.correction?.status === "pending") return false;
  if (isCancelled(outing)) return false;
  if (outing.returned_at === null) return true;
  return Date.parse(outing.returned_at) >= nowMs - STUDENT_CAN_ASK_DAYS * DAY_MS;
}

/** The kind that changes the return time: record it (still open) or change it (closed). */
export function timeKind(outing: { returned_at?: string | null }): CorrectionKind {
  return outing.returned_at ? "return_time" : "return";
}

/** How the return was recorded, when it wasn't the student or a gate. */
export function inViaLabel(via: InVia | null | undefined): string | null {
  if (via === "staff") return "Recorded by the office";
  if (via === "unrecorded") return "Return time not recorded";
  return null;
}

/** What a correction form sends: POST /outings/{id}/correction or /admin/outings/{id}/correction. */
export interface CorrectionBody {
  kind: CorrectionKind;
  returned_at: string | null;
  reason: string;
}

const KINDS: readonly CorrectionKind[] = ["return", "return_time", "cancel"];

/**
 * Checks a correction form before it goes to the server (which checks again). `time` is the
 * datetime-local value (IST); `leftAt` when the outing started. `who` picks the wording.
 */
export function correctionBody(
  fields: { kind: string; time: string; leftAt: string; reason: string },
  who: "student" | "staff",
): { body: CorrectionBody } | { error: string } {
  const kind = KINDS.find((k) => k === fields.kind);
  if (!kind) return { error: "Choose what happened." };
  let returnedAt: string | null = null;
  if (kind !== "cancel") {
    if (!fields.time) {
      return { error: who === "student" ? "Say when you came back." : "Say when they came back." };
    }
    returnedAt = istInputToIso(fields.time, fields.leftAt);
    if (!returnedAt) return { error: "Enter the date and time in full." };
  }
  const reason = fields.reason.trim();
  if (reason.length < 3) {
    return {
      error:
        who === "student"
          ? "Tell the hostel office what happened, in a few words."
          : "Give a reason, for the record.",
    };
  }
  if (reason.length > 300) return { error: "Keep the reason under 300 characters." };
  return { body: { kind, returned_at: returnedAt, reason } };
}

/** "8:40 PM" on the same IST day as `sameDayAs`, else "Tue, 4 Nov, 8:40 PM". */
export function whenShort(iso: string, sameDayAs?: string): string {
  const sameDay = sameDayAs !== undefined && formatDay(iso) === formatDay(sameDayAs);
  return sameDay ? formatTime(iso) : `${formatDay(iso)}, ${formatTime(iso)}`;
}

/** What was asked, without a subject: "came back at 8:40 PM" or "this trip didn't happen". */
export function askedFor(correction: Correction, leftAt: string): string {
  if (correction.kind === "cancel" || !correction.returned_at) return "this trip didn't happen";
  return `came back at ${whenShort(correction.returned_at, leftAt)}`;
}

/** The student's view of the latest correction: a headline, and the detail under it. */
export interface CorrectionLine {
  label: string;
  tone: "waiting" | "done" | "refused";
  /** A time that was replaced, shown struck through after "was". */
  was?: string | null;
  detail?: string | null;
}

export function correctionLine(correction: Correction, leftAt: string): CorrectionLine | null {
  switch (correction.status) {
    case "pending":
      return {
        label: "Waiting for the hostel office",
        tone: "waiting",
        detail:
          correction.kind === "cancel" || !correction.returned_at
            ? "You said the trip didn't happen."
            : `You said you came back at ${whenShort(correction.returned_at, leftAt)}.`,
      };
    case "approved":
      if (correction.kind === "cancel")
        return { label: "Cancelled by the hostel office", tone: "done" };
      return correction.old_returned_at
        ? {
            label: "Corrected by the hostel office",
            tone: "done",
            was: whenShort(correction.old_returned_at, leftAt),
          }
        : { label: "Return recorded by the hostel office", tone: "done" };
    case "declined":
      return {
        label: "The hostel office didn't change this",
        tone: "refused",
        detail: correction.note ? `Their note: ${correction.note}` : null,
      };
    default:
      return null; // cancelled: the office corrected the outing itself (a newer correction)
  }
}
