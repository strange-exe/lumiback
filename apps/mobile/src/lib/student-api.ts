/** A student's own outing calls that more than one screen makes. */
import { api } from "@/lib/api";
import type { RunningLateBody } from "@/lib/running-late";
import type { Correction, CorrectionBody, HelpFix, HelpSent, Outing } from "@/lib/types";

export const student = {
  /** "Ask the office to call me" while out, for a hostel with no office number (202; 429
   * after 3 in an hour; 404 when not out). */
  callMe: () => api<void>("/outings/current/call-me", { method: "POST" }),
  /** The Help button, after the app confirms: one location fix at most (5 an hour). `session`:
   * the sessionGeneration() read when the student confirmed (see api's `session`). */
  help: (location: HelpFix | null, session: number) =>
    api<HelpSent>("/outings/current/help", {
      method: "POST",
      body: location ? { location } : {},
      session,
    }),
  /** "Running late?": move the due-back time once per outing (15, 30 or 60 minutes). Returns
   * the updated outing; 409 with the reason when it's too late or already used. */
  runningLate: (body: RunningLateBody) =>
    api<Outing>("/outings/current/running-late", { method: "POST", body }),
  /** Ask the hostel office to fix an outing: open, or ended in the last 7 days. Nothing
   * changes until they approve (409 when an ask about it is already waiting). */
  askCorrection: (outingId: string, body: CorrectionBody) =>
    api<Correction>(`/outings/${encodeURIComponent(outingId)}/correction`, {
      method: "POST",
      body,
    }),
};
