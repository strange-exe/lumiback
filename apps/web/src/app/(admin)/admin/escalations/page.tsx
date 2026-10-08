import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { adminApi } from "@/features/admin/api";
import { AutoRefresh } from "@/features/admin/components/AutoRefresh";
import { EscalationCard } from "@/features/admin/components/EscalationCard";
import { requireAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "Escalations" };

interface PageProps {
  searchParams: Promise<{ state?: string }>;
}

export default async function EscalationsPage({ searchParams }: PageProps): Promise<ReactNode> {
  const { token } = await requireAdmin();
  const all = (await searchParams).state === "all";
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
            Students 30 minutes late get an &ldquo;are you OK?&rdquo; alert in the app. If they
            don&apos;t answer within 10 minutes, they appear here. Call them, their emergency
            contact, or their hostel&apos;s warden.
          </p>
        </div>
        <nav aria-label="Filter" className="flex gap-1 rounded-control bg-accent-soft p-1">
          {[
            { href: "/admin/escalations", label: "Open", current: !all },
            { href: "/admin/escalations?state=all", label: "All", current: all },
          ].map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={tab.current ? "page" : undefined}
              className={`flex min-h-10 items-center rounded-[10px] px-3 text-sm font-bold ${
                tab.current ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              {tab.label}
            </Link>
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
