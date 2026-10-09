import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Gate } from "@/components/illustrations/Gate";
import { outingsApi } from "@/features/outings/api";
import { CheckOutForm } from "@/features/outings/components/CheckOutForm";
import { OutView } from "@/features/outings/components/OutView";
import { RequestPanel } from "@/features/outings/components/RequestPanel";
import { isFreeNow, RulesCard } from "@/features/outings/components/RulesCard";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Today" };

export default async function HomePage(): Promise<ReactNode> {
  const { user, token } = await requireUser();
  const outing = await outingsApi.current(token);

  if (outing) return <OutView outing={outing} serverNow={new Date().toISOString()} />;

  const campus = await outingsApi.campus(token);
  const rules = campus?.today ?? null;
  // Rendered per request, so the server's clock decides the no-form evening.
  const free = rules ? isFreeNow(rules, new Date()) : false;
  const formNeeded = Boolean(rules?.needs_form) && !free;
  const [request, profile] = formNeeded
    ? await Promise.all([outingsApi.request(token), outingsApi.profile(token).catch(() => null)])
    : [null, null];
  const approved = request?.status === "approved" && !request.used;

  return (
    <section aria-labelledby="checkout-heading" className="flex flex-col gap-6">
      <div>
        <p className="font-display text-lg text-muted">Hi {user.name.split(" ")[0]},</p>
        <h1 id="checkout-heading" className="font-display text-title text-ink">
          Heading out?
        </h1>
      </div>
      <Gate className="mx-auto w-full max-w-[16rem]" />
      {rules ? <RulesCard rules={rules} free={free} /> : null}
      {formNeeded && rules ? (
        <RequestPanel rules={rules} request={request} profile={profile} />
      ) : null}
      {/* On form days, checking out needs the approval first: the panel above comes first. */}
      {!formNeeded || approved ? <CheckOutForm /> : null}
    </section>
  );
}
