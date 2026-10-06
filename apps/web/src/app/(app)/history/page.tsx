import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { Lantern } from "@/components/illustrations/Lantern";
import { outingsApi } from "@/features/outings/api";
import { HistoryLedger } from "@/features/outings/components/HistoryLedger";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "History" };

interface PageProps {
  searchParams: Promise<{ before?: string }>;
}

export default async function HistoryPage({ searchParams }: PageProps): Promise<ReactNode> {
  const { token } = await requireUser();
  const { before } = await searchParams;
  const [page, summary] = await Promise.all([
    outingsApi.history(token, before),
    outingsApi.summary(token),
  ]);

  if (summary.total === 0) {
    return (
      <section className="flex flex-col items-center gap-4 py-10 text-center">
        <Lantern lit={false} className="h-24 w-20" />
        <h1 className="font-display text-title text-ink">No outings yet</h1>
        <p className="max-w-xs text-stone">Your trips will appear here once you check out.</p>
        <Link href="/home" className="font-bold text-pine underline-offset-4 hover:underline">
          Plan an outing
        </Link>
      </section>
    );
  }

  const onTime =
    summary.on_time_rate === null ? "None yet" : `${Math.round(summary.on_time_rate * 100)}%`;

  return (
    <section aria-labelledby="history-heading" className="flex flex-col gap-6">
      <h1 id="history-heading" className="font-display text-title text-ink">
        Your outings
      </h1>
      <dl className="grid grid-cols-3 divide-x divide-line">
        {[
          { label: "Outings", value: String(summary.total) },
          { label: "Back on time", value: onTime },
          { label: "Late returns", value: String(summary.returned_late) },
        ].map((stat) => (
          <div key={stat.label} className="flex flex-col-reverse gap-0.5 px-3 first:pl-0">
            <dt className="text-sm text-stone">{stat.label}</dt>
            <dd className="font-display text-title tabular-nums text-ink">{stat.value}</dd>
          </div>
        ))}
      </dl>
      <HistoryLedger items={page.items} />
      {page.next_before && (
        <Link
          href={`/history?before=${encodeURIComponent(page.next_before)}`}
          className="self-center font-bold text-pine underline-offset-4 hover:underline"
        >
          Older outings
        </Link>
      )}
    </section>
  );
}
