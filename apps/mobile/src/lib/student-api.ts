/** A student's own outing calls that more than one screen makes. */
import { api } from "@/lib/api";
import type { Correction, CorrectionBody } from "@/lib/types";

export const student = {
  /** Ask the hostel office to fix an outing: open, or ended in the last 7 days. Nothing
   * changes until they approve (409 when an ask about it is already waiting). */
  askCorrection: (outingId: string, body: CorrectionBody) =>
    api<Correction>(`/outings/${encodeURIComponent(outingId)}/correction`, {
      method: "POST",
      body,
    }),
};
