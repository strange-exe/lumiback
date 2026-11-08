import Link from "next/link";
import type { ReactNode } from "react";

import { formatWhen } from "@/features/admin/format";
import { recordHref } from "@/features/admin/record";
import type { AdminScan, ScanResult } from "@/lib/types";

export const SCAN_RESULTS: Readonly<Record<ScanResult, string>> = {
  accepted: "Accepted",
  bad_code: "Invalid or old code",
  gate_off: "Gate switched off",
  too_far: "Too far from the gate",
  weak_gps: "GPS too weak",
  mock_gps: "Mock location",
  not_allowed: "Outside the outing rules",
};

/**
 * One gate scan: who, which way and where, when, and the result in words (colour repeats it).
 * `linkName`: the name opens the student's record (off on the record itself).
 */
export function ScanRow({
  scan,
  linkName = true,
}: {
  scan: AdminScan;
  linkName?: boolean;
}): ReactNode {
  const accepted = scan.result === "accepted";
  const distance =
    scan.distance_m === null
      ? null
      : `${Math.round(scan.distance_m)} m from gate${
          scan.accuracy_m === null ? "" : ` (GPS ±${Math.round(scan.accuracy_m)} m)`
        }`;
  return (
    <li className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 py-3.5 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <p className="truncate font-bold text-ink">
          {linkName && scan.student_id ? (
            <Link
              href={recordHref(scan.student_id)}
              prefetch={false}
              className="underline decoration-line underline-offset-4 hover:decoration-ink"
            >
              {scan.name}
            </Link>
          ) : (
            scan.name
          )}
        </p>
        <p className="truncate text-sm text-muted">
          {scan.direction === "out" ? "Tapping out" : "Tapping in"}
          {scan.gate ? ` · ${scan.gate}` : ""}
          {scan.roll_no ? ` · ${scan.roll_no}` : ""}
        </p>
      </div>
      <p className="col-start-2 row-start-1 text-right text-sm tabular-nums text-muted sm:col-start-3">
        {formatWhen(scan.scanned_at)}
      </p>
      <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm sm:col-span-1 sm:col-start-2 sm:row-start-1">
        <span
          className={`inline-flex rounded-full px-2.5 py-0.5 font-bold ${
            accepted ? "bg-good-soft text-good" : "bg-danger-soft text-danger"
          }`}
        >
          {SCAN_RESULTS[scan.result] ?? "Refused"}
        </span>
        {distance && <span className="tabular-nums text-muted">{distance}</span>}
      </div>
    </li>
  );
}
