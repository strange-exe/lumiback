/** A student's history in the office app: its lists, paging and wording. The API decides who
 * may see it (a warden: their hostels' students only). */
import { correctionAsk } from "@/lib/corrections";
import type { Correction, RequestStatus } from "@/lib/types";

export const RECORD_TABS = [
  { value: "outings", label: "Outings" },
  { value: "requests", label: "Requests" },
  { value: "scans", label: "Scans" },
] as const;
export type RecordTab = (typeof RECORD_TABS)[number]["value"];

const PER_PAGE = 20;

/** The API path for one list of a student's history, a page at a time. */
export function recordPath(id: string, list: RecordTab, before?: string | number | null): string {
  const query = new URLSearchParams({ limit: String(PER_PAGE) });
  if (before != null && before !== "") query.set("before", String(before));
  return `/admin/students/${encodeURIComponent(id)}/${list}?${query.toString()}`;
}

const CORRECTION_STATUS: Record<RequestStatus, string> = {
  pending: "Waiting for a decision",
  approved: "Applied",
  declined: "Declined",
  cancelled: "Replaced by a later correction",
};

/** One correction on the history, in the office's words. */
export function correctionLines(c: Correction): { title: string; detail: string } {
  const who = c.by_staff ? "Office" : "Student asked";
  const parts = [CORRECTION_STATUS[c.status] ?? c.status, `Reason: ${c.reason}`];
  if (c.note) parts.push(`Office note: ${c.note}`);
  return { title: `${who}: ${correctionAsk(c)}`, detail: parts.join(" · ") };
}

/** A request's decision in words; the chip's colour only repeats it. */
export const REQUEST_STATUS: Record<
  RequestStatus,
  { label: string; tone: "accent" | "good" | "danger" | "muted" }
> = {
  pending: { label: "Waiting", tone: "accent" },
  approved: { label: "Approved", tone: "good" },
  declined: { label: "Declined", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "muted" },
};
