import type { Metadata } from "next";
import type { ReactNode } from "react";

import { adminApi } from "@/features/admin/api";
import { AutoRefresh } from "@/features/admin/components/AutoRefresh";
import { CorrectionAskCard, UnrecordedCard } from "@/features/admin/components/CorrectionForms";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Corrections" };

export default async function CorrectionsPage(): Promise<ReactNode> {
  const { token } = await requireStaff();
  const queue = await adminApi.corrections(token);
  // Rendered per request: the server's clock fills in "now" for the forms.
  const nowIso = new Date().toISOString();

  return (
    <div className="flex flex-col gap-10">
      <AutoRefresh seconds={60} />
      <div className="flex flex-col gap-1">
        <h1 id="corrections-heading" className="font-display text-title text-ink">
          Corrections
        </h1>
        <p className="max-w-[65ch] text-muted">
          Outings whose return time is wrong or missing, or that never happened. Students ask here
          when they forget to tap in. You can also correct any outing from the Register.
        </p>
      </div>

      <section aria-labelledby="asks-heading" className="flex flex-col gap-4">
        <h2 id="asks-heading" className="font-display text-xl text-ink">
          Asked by students
          {queue.asks.length ? (
            <span className="ml-2 text-base font-normal text-muted">{queue.asks.length}</span>
          ) : null}
        </h2>
        {queue.asks.length === 0 ? (
          <p className="rounded-sheet border border-dashed border-line px-5 py-8 text-center text-muted">
            No questions from students. When one says they came back at a different time, or that a
            trip didn&apos;t happen, it appears here for you to approve or decline.
          </p>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {queue.asks.map((ask) => (
              <CorrectionAskCard key={ask.correction.id} ask={ask} nowIso={nowIso} />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="unrecorded-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="unrecorded-heading" className="font-display text-xl text-ink">
            Return times to fix
            {queue.unrecorded.length ? (
              <span className="ml-2 text-base font-normal text-muted">
                {queue.unrecorded.length}
              </span>
            ) : null}
          </h2>
          <p className="max-w-[65ch] text-sm text-muted">
            These students tapped out at a gate on a later day without tapping back in, so when they
            came back isn&apos;t known. Set the time if you know it. They aren&apos;t counted as
            late meanwhile.
          </p>
        </div>
        {queue.unrecorded.length === 0 ? (
          <p className="rounded-sheet border border-dashed border-line px-5 py-8 text-center text-muted">
            Nothing to fix. Every return in the last 30 days has a time.
          </p>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {queue.unrecorded.map((outing) => (
              <UnrecordedCard key={outing.id} outing={outing} nowIso={nowIso} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
