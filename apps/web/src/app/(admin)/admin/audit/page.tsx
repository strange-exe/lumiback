import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { FormError } from "@/components/ui/Field";
import { adminApi } from "@/features/admin/api";
import { formatWhen, istToday } from "@/features/admin/format";
import { actionLabel, AUDIT_AREA_LABELS, AUDIT_AREAS } from "@/lib/audit-areas";
import { extrasFrom, filterHref, MAX_Q, pageHref, resolveFilters } from "@/lib/filters";
import { rememberedFilters, requireAdmin } from "@/lib/session";
import type { AuditEntry, Role } from "@/lib/types";

export const metadata: Metadata = { title: "Audit log" };

const ROLE_LABEL: Record<Role, string> = {
  student: "Student",
  warden: "Warden",
  head_warden: "Head warden",
  admin: "Admin",
  developer: "Developer",
};

interface PageProps {
  searchParams: Promise<{
    before?: string;
    area?: string;
    q?: string | string[];
    from?: string;
    to?: string;
  }>;
}

/** Every change made in the hostel office, newest first. Read only; admins and developers. */
export default async function AuditPage({ searchParams }: PageProps): Promise<ReactNode> {
  const { token } = await requireAdmin();
  const params = await searchParams;
  // The address's area, or on a bare visit the one chosen last time (lib/filters.ts).
  const { values } = resolveFilters("audit", params, await rememberedFilters());
  const area = values.area;
  const { q = "", from, to } = extrasFrom("audit", params);
  const typed = typeof params.q === "string" ? params.q.trim() : "";
  const backwards = Boolean(from && to && to < from);
  const before = params.before && /^[1-9]\d{0,17}$/.test(params.before) ? params.before : undefined;
  const page = backwards
    ? { items: [], next_before: null }
    : await adminApi.audit(token, { before, area, q: q || undefined, from, to });

  const chosen: Record<string, string> = area ? { area } : {};
  const here = pageHref("audit", chosen, { q, from, to });
  const older =
    page.next_before === null
      ? null
      : `${here}${here.includes("?") ? "&" : "?"}before=${page.next_before}`;
  const filtered = Boolean(area || q || from || to);
  const today = istToday();
  const control = "min-h-11 rounded-control border border-line bg-surface px-3 text-sm text-ink";

  return (
    <section aria-labelledby="audit-heading" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 id="audit-heading" className="font-display text-title text-ink">
          Audit log
        </h1>
        <p className="max-w-[65ch] text-muted">
          Every change made in the hostel office: who made it, when, and what it changed. Nobody can
          edit or delete these entries.
        </p>
      </div>

      {/* Sent to /admin/filter, which remembers the area (not the search or dates). */}
      <form
        method="get"
        action="/admin/filter"
        role="search"
        aria-label="Filter the audit log"
        className="flex flex-col gap-3"
      >
        <input type="hidden" name="view" value="audit" />
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[min(100%,16rem)] flex-1 flex-col gap-1.5 text-sm font-bold text-ink">
            Who, or what was changed
            <input
              type="search"
              name="q"
              defaultValue={typed || q}
              minLength={2}
              maxLength={MAX_Q}
              className={`${control} font-normal`}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-bold text-ink">
            Area
            <select name="area" defaultValue={area ?? ""} className={control}>
              <option value="">Every area</option>
              {AUDIT_AREAS.map((value) => (
                <option key={value} value={value}>
                  {AUDIT_AREA_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-bold text-ink">
            From
            <input
              type="date"
              name="from"
              defaultValue={from}
              max={today}
              className={`${control} font-normal`}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-bold text-ink">
            To
            <input
              type="date"
              name="to"
              defaultValue={to}
              max={today}
              className={`${control} font-normal`}
            />
          </label>
          <button
            type="submit"
            className="min-h-11 rounded-control bg-ink px-4 text-sm font-bold text-page hover:opacity-90"
          >
            Filter
          </button>
          {filtered && (
            <a
              href={filterHref("audit", {})}
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
            ? "No changes match these filters."
            : "No changes yet. They appear here as the office adds people, sets rules and more."}
        </p>
      ) : (
        <ol aria-labelledby="audit-heading" className="divide-y divide-line border-y border-line">
          {page.items.map((entry) => (
            <AuditRow key={entry.id} entry={entry} />
          ))}
        </ol>
      )}

      {older && (
        <Link
          href={older}
          className="flex min-h-11 items-center self-center font-bold text-accent-text underline-offset-4 hover:underline"
        >
          Older changes
        </Link>
      )}
    </section>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }): ReactNode {
  const who = entry.actor_name ?? "A deleted account";
  const role = entry.actor_role ? ROLE_LABEL[entry.actor_role] : null;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 py-3.5">
      <p className="min-w-0 font-bold text-ink">{actionLabel(entry.action)}</p>
      <p className="text-right text-sm tabular-nums text-muted">
        <time dateTime={entry.at}>{formatWhen(entry.at)}</time>
      </p>
      <p className="col-span-2 min-w-0 break-words text-sm text-ink">{entry.target}</p>
      <p className="col-span-2 min-w-0 truncate text-sm text-muted">
        By {who}
        {role ? ` (${role})` : ""}
        {entry.actor_email ? ` · ${entry.actor_email}` : ""}
      </p>
    </li>
  );
}
