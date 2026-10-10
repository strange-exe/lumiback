import type { Metadata } from "next";
import type { ReactNode } from "react";

import { adminApi } from "@/features/admin/api";
import { AutoRefresh } from "@/features/admin/components/AutoRefresh";
import { RequestCard } from "@/features/admin/components/RequestCard";
import { requireAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "Requests" };

export default async function RequestsPage(): Promise<ReactNode> {
  const { token } = await requireAdmin();
  const requests = await adminApi.requests(token);
  const pending = requests.filter((r) => r.status === "pending").length;

  return (
    <section aria-labelledby="requests-heading" className="flex flex-col gap-6">
      <AutoRefresh />
      <div className="flex flex-col gap-1">
        <h1 id="requests-heading" className="font-display text-title text-ink">
          Outing requests
        </h1>
        <p className="max-w-[65ch] text-muted">
          Days that need approval (currently Sundays and holidays) need an approved form. Students
          send it on the day; once you approve it they can tap out at the gate or check out on the
          website, once, for up to the day&apos;s limit.
          {pending ? ` ${pending} waiting for you.` : ""}
        </p>
      </div>
      {requests.length === 0 ? (
        <p className="rounded-sheet border border-dashed border-line px-5 py-10 text-center text-muted">
          No requests today. They appear here on days that need approval, as students send them.
        </p>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {requests.map((r) => (
            <RequestCard key={r.id} request={r} />
          ))}
        </div>
      )}
    </section>
  );
}
