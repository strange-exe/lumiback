/**
 * A student's record page (/admin/people/<id>): its address, its tabs and their paging. Every
 * value read from the address is checked; anything else means the first page of outings.
 * Pure, so `node --test` can load it.
 */

import { isUuid } from "../../lib/ids.ts";
import type { Correction, RequestStatus } from "../../lib/types.ts";
import { askedFor, whenShort } from "../outings/corrections.ts";

const CORRECTION_STATUS: Readonly<Record<RequestStatus, string>> = {
  pending: "Waiting for a decision",
  approved: "Applied",
  declined: "Declined",
  cancelled: "Replaced by a later correction",
};

export interface CorrectionText {
  /** "Student asked: came back at 8:40 PM" */
  title: string;
  status: string;
  /** The reason given, what the record said before, and the office's note. */
  details: string[];
}

/** One correction on a student's record, in the office's words. */
export function correctionText(correction: Correction, leftAt: string): CorrectionText {
  const who = correction.by_staff ? "The office recorded" : "Student asked";
  const details = [`Reason: ${correction.reason}`];
  if (correction.old_returned_at) {
    details.push(`Was back at ${whenShort(correction.old_returned_at, leftAt)}`);
  }
  if (correction.note) details.push(`Office note: ${correction.note}`);
  return {
    title: `${who}: ${askedFor(correction, leftAt)}`,
    status: CORRECTION_STATUS[correction.status] ?? correction.status,
    details,
  };
}

export const RECORD_TABS = ["outings", "requests", "scans"] as const;
export type RecordTab = (typeof RECORD_TABS)[number];

export const RECORD_TAB_LABELS: Readonly<Record<RecordTab, string>> = {
  outings: "Outings",
  requests: "Requests",
  scans: "Gate scans",
};

/** IST ISO time, as the API sends `next_before` for outings and requests. */
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
/** A scan id. */
const SCAN_ID = /^[1-9]\d{0,17}$/;

export function recordHref(id: string, tab: RecordTab = "outings", before?: string): string {
  const query = new URLSearchParams();
  if (tab !== "outings") query.set("show", tab);
  if (before) query.set("before", before);
  const search = query.toString();
  return `/admin/people/${encodeURIComponent(id)}${search ? `?${search}` : ""}`;
}

export interface RecordView {
  tab: RecordTab;
  /** A checked cursor for the tab's list, or undefined for its newest page. */
  before: string | undefined;
}

/** The tab and page asked for; a cursor that doesn't fit the tab is dropped. */
export function recordView(query: Readonly<Record<string, unknown>>): RecordView {
  const show = query.show;
  const tab: RecordTab =
    typeof show === "string" && (RECORD_TABS as readonly string[]).includes(show)
      ? (show as RecordTab)
      : "outings";
  const raw = query.before;
  const fits =
    typeof raw === "string" &&
    (tab === "scans" ? SCAN_ID.test(raw) : ISO.test(raw) && !Number.isNaN(Date.parse(raw)));
  return { tab, before: fits ? raw : undefined };
}

/** The record's id from the address: a UUID (lower case), else null (the page 404s). */
export function recordId(value: unknown): string | null {
  return isUuid(value) ? value.toLowerCase() : null;
}
