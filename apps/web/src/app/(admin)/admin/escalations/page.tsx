import type { Metadata } from "next";
import type { ReactNode } from "react";

import { adminApi } from "@/features/admin/api";
import { AutoRefresh } from "@/features/admin/components/AutoRefresh";
import { EscalationCard } from "@/features/admin/components/EscalationCard";
import { filterHref, resolveFilters } from "@/lib/filters";
import { rememberedFilters, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Escalations" };

interface PageProps {
  searchParams: Promise<{ state?: string }>;
}

export default async function EscalationsPage({ searchParams }: PageProps): Promise<ReactNode> {
  const { token } = await requireStaff();
  // The address's filter, or on a bare visit the one chosen last time (lib/filters.ts).
  const { values } = resolveFilters("escalations", await searchParams, await rememberedFilters());
  const all = values.state === "all";
  const escalations = await adminApi.escalations(token, all ? "all" : "open");

  return (
    <section aria-labelledby="escalations-heading" className="flex flex-col gap-6">
      <AutoRefresh />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 id="escalations-heading" className="font-display text-title text-ink">
            Escalations
          </h1>
          <p className="max-w-[65ch] text-muted">
            Students 30 minutes late get an &ldquo;are you OK?&rdquo; alert: a notification in the
            app, or an email if they only use the website. If they don&apos;t answer within 10
            minutes, they appear here. Call them, their emergency contact, or their hostel&apos;s
            warden.
          </p>
        </div>
        <nav aria-label="Filter" className="flex gap-1 rounded-control bg-accent-soft p-1">
          {[
            { href: filterHref("escalations", {}), label: "Open", current: !all },
            { href: filterHref("escalations", { state: "all" }), label: "All", current: all },
          ].map((tab) => (
            // A plain link (no prefetch): following it remembers the choice.
            <a
              key={tab.href}
              href={tab.href}
              aria-current={tab.current ? "page" : undefined}
              className={`flex min-h-10 items-center rounded-[10px] px-3 text-sm font-bold ${
                tab.current ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              {tab.label}
            </a>
          ))}
        </nav>
      </div>
      {escalations.length === 0 ? (
        <p className="rounded-sheet border border-dashed border-line px-5 py-10 text-center text-muted">
          {all ? "No escalations yet." : "Nothing to follow up. Everyone late has answered."}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {escalations.map((e) => (
            <EscalationCard key={e.id} escalation={e} />
          ))}
        </div>
      )}
    </section>
  );
}
