import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { adminApi } from "@/features/admin/api";
import { formatWhen } from "@/features/admin/format";
import { requireAdmin } from "@/lib/session";
import type { AdminScan, ScanResult } from "@/lib/types";

export const metadata: Metadata = { title: "Scans" };

const RESULTS: Record<ScanResult, string> = {
  accepted: "Accepted",
  bad_code: "Invalid or old code",
  gate_off: "Gate switched off",
  too_far: "Too far from the gate",
  weak_gps: "GPS too weak",
  mock_gps: "Mock location",
};

interface PageProps {
  searchParams: Promise<{ before?: string; gate?: string; result?: string }>;
}

export default async function ScansPage({ searchParams }: PageProps): Promise<ReactNode> {
  const { token } = await requireAdmin();
  const params = await searchParams;
  const result =
    params.result && params.result in RESULTS ? (params.result as ScanResult) : undefined;
  const before = params.before && /^\d+$/.test(params.before) ? params.before : undefined;
  const gates = await adminApi.gates(token);
  const gate = gates.some((g) => g.id === params.gate) ? params.gate : undefined;
  const page = await adminApi.scans(token, { before, gate, result });

  const older = new URLSearchParams();
  if (gate) older.set("gate", gate);
  if (result) older.set("result", result);
  if (page.next_before !== null) older.set("before", String(page.next_before));

  const select = "min-h-11 rounded-control border border-line bg-surface px-3 text-sm text-ink";

  return (
    <section aria-labelledby="scans-heading" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 id="scans-heading" className="font-display text-title text-ink">
          Gate scans
        </h1>
        <p className="max-w-[65ch] text-muted">
          Every scan, including refused ones. We keep the distance from the gate, never a
          student&apos;s location.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-bold text-ink">
          Gate
          <select name="gate" defaultValue={gate ?? ""} className={select}>
            <option value="">All gates</option>
            {gates.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-bold text-ink">
          Result
          <select name="result" defaultValue={result ?? ""} className={select}>
            <option value="">Any result</option>
            {Object.entries(RESULTS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="min-h-11 rounded-control bg-ink px-4 text-sm font-bold text-page hover:opacity-90"
        >
          Filter
        </button>
        {(gate || result) && (
          <Link
            href="/admin/scans"
            className="flex min-h-11 items-center px-2 text-sm font-bold text-accent"
          >
            Clear
          </Link>
        )}
      </form>

      {page.items.length === 0 ? (
        <p className="rounded-sheet border border-dashed border-line px-5 py-10 text-center text-muted">
          {gate || result
            ? "No scans match these filters."
            : "No scans yet. They appear here as students tap out and in at a gate."}
        </p>
      ) : (
        <ol className="divide-y divide-line border-y border-line">
          {page.items.map((scan) => (
            <ScanRow key={scan.id} scan={scan} />
          ))}
        </ol>
      )}

      {page.next_before !== null && (
        <Link
          href={`/admin/scans?${older.toString()}`}
          className="self-center font-bold text-accent underline-offset-4 hover:underline"
        >
          Older scans
        </Link>
      )}
    </section>
  );
}

function ScanRow({ scan }: { scan: AdminScan }): ReactNode {
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
        <p className="truncate font-bold text-ink">{scan.name}</p>
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
          {RESULTS[scan.result]}
        </span>
        {distance && <span className="tabular-nums text-muted">{distance}</span>}
      </div>
    </li>
  );
}
