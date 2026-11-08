import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { FormError } from "@/components/ui/Field";
import { adminApi } from "@/features/admin/api";
import { ScanRow, SCAN_RESULTS } from "@/features/admin/components/ScanRow";
import { istToday } from "@/features/admin/format";
import { extrasFrom, filterHref, MAX_Q, pageHref, resolveFilters } from "@/lib/filters";
import { rememberedFilters, requireStaff } from "@/lib/session";
import type { ScanResult } from "@/lib/types";

export const metadata: Metadata = { title: "Scans" };

interface PageProps {
  searchParams: Promise<{
    before?: string;
    gate?: string;
    result?: string;
    q?: string | string[];
    from?: string;
    to?: string;
  }>;
}

export default async function ScansPage({ searchParams }: PageProps): Promise<ReactNode> {
  const { token } = await requireStaff();
  const params = await searchParams;
  // The address's filters, or on a bare visit the ones chosen last time (lib/filters.ts). A
  // search and dates are never remembered.
  const { values } = resolveFilters("scans", params, await rememberedFilters());
  const result =
    values.result && values.result in SCAN_RESULTS ? (values.result as ScanResult) : undefined;
  const { q = "", from, to } = extrasFrom("scans", params);
  const typed = typeof params.q === "string" ? params.q.trim() : "";
  const backwards = Boolean(from && to && to < from);
  const before = params.before && /^\d+$/.test(params.before) ? params.before : undefined;
  const gates = await adminApi.gates(token);
  // A remembered gate that's since been removed is simply not applied.
  const gate = gates.some((g) => g.id === values.gate) ? values.gate : undefined;
  const page = backwards
    ? { items: [], next_before: null }
    : await adminApi.scans(token, { before, gate, result, q: q || undefined, from, to });

  const chosen = { ...(gate ? { gate } : {}), ...(result ? { result } : {}) };
  const extras = { q, from, to };
  const here = pageHref("scans", chosen, extras);
  const older =
    page.next_before === null
      ? null
      : `${here}${here.includes("?") ? "&" : "?"}before=${page.next_before}`;
  const filtered = Boolean(gate || result || q || from || to);
  const today = istToday();

  const select = "min-h-11 rounded-control border border-line bg-surface px-3 text-sm text-ink";
  const input = `${select} font-normal`;

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

      {/* Sent to /admin/filter, which remembers the gate and result (not the search or dates)
          and opens this page with them. */}
      <form
        method="get"
        action="/admin/filter"
        role="search"
        aria-label="Filter scans"
        className="flex flex-col gap-3"
      >
        <input type="hidden" name="view" value="scans" />
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[min(100%,16rem)] flex-1 flex-col gap-1.5 text-sm font-bold text-ink">
            Student name or roll number
            <input
              type="search"
              name="q"
              defaultValue={typed || q}
              minLength={2}
              maxLength={MAX_Q}
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-bold text-ink">
            From
            <input type="date" name="from" defaultValue={from} max={today} className={input} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-bold text-ink">
            To
            <input type="date" name="to" defaultValue={to} max={today} className={input} />
          </label>
        </div>
        <div className="flex flex-wrap items-end gap-3">
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
              {Object.entries(SCAN_RESULTS).map(([value, label]) => (
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
          {filtered && (
            <a
              href={filterHref("scans", {})}
              className="flex min-h-11 items-center px-2 text-sm font-bold text-accent-text underline-offset-4 hover:underline"
            >
              Clear
            </a>
          )}
        </div>
        {typed && !q && <p className="text-sm text-muted">Type at least 2 letters to search.</p>}
      </form>

      {backwards ? (
        <FormError message="The end date is before the start date. Choose the dates again." />
      ) : page.items.length === 0 ? (
        <p className="rounded-sheet border border-dashed border-line px-5 py-10 text-center text-muted">
          {filtered
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

      {older && (
        <Link
          href={older}
          className="flex min-h-11 items-center self-center font-bold text-accent-text underline-offset-4 hover:underline"
        >
          Older scans
        </Link>
      )}
    </section>
  );
}
