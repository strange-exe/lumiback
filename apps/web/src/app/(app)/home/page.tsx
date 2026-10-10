import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Gate } from "@/components/illustrations/Gate";
import { outingsApi } from "@/features/outings/api";
import { CheckOutForm } from "@/features/outings/components/CheckOutForm";
import { OutView } from "@/features/outings/components/OutView";
import { RequestPanel } from "@/features/outings/components/RequestPanel";
import { isFreeNow, RulesCard } from "@/features/outings/components/RulesCard";
import { closedAt } from "@/features/outings/rules";
import { formatTime } from "@/features/outings/time";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Today" };

function Notice({
  children,
  tone = "accent",
}: {
  children: ReactNode;
  tone?: "accent" | "danger";
}): ReactNode {
  return (
    <p
      role="status"
      className={`rounded-control px-4 py-3 text-ink ${tone === "danger" ? "bg-danger-soft" : "bg-accent-soft"}`}
    >
      {children}
    </p>
  );
}

export default async function HomePage(): Promise<ReactNode> {
  const { user, token } = await requireUser();
  const outing = await outingsApi.current(token);

  if (outing) return <OutView outing={outing} serverNow={new Date().toISOString()} />;

  // Rendered per request, so the server's clock decides what is open right now.
  const now = new Date();
  const campus = await outingsApi.campus(token); // null: couldn't be loaded
  const rules = campus?.today ?? null; // null with campus loaded: no rules set up
  const free = rules ? isFreeNow(rules, now) : false;
  const closed = rules ? closedAt(rules, now.getTime()) : null;
  // A request can be sent before outings open, but not once they're over for today.
  const formNeeded = Boolean(rules?.needs_form) && !free && closed !== "after";
  // undefined: the request couldn't be loaded (null: there is none today).
  const [request, profile] = formNeeded
    ? await Promise.all([
        outingsApi.request(token).catch(() => undefined),
        outingsApi.profile(token).catch(() => null),
      ])
    : [null, null];
  const approved = request?.status === "approved" && !request.used;

  let body: ReactNode;
  if (!campus) {
    // The server still applies the rules: checking out stays possible, it just can't be previewed.
    body = (
      <>
        <Notice tone="danger">Couldn&apos;t load today&apos;s rules. Reload to try again.</Notice>
        <CheckOutForm />
      </>
    );
  } else if (!rules) {
    body = <Notice>Outing rules aren&apos;t set up yet. Ask the hostel office.</Notice>;
  } else {
    body = (
      <>
        <RulesCard rules={rules} free={free} />
        {closed === "after" ? (
          <Notice>
            <strong>Outings are over for today.</strong> {rules.label} hours were{" "}
            {formatTime(rules.opens_at)}–{formatTime(rules.return_by)}.
          </Notice>
        ) : null}
        {formNeeded && request === undefined ? (
          <Notice tone="danger">
            Couldn&apos;t load your outing request. Reload to try again.
          </Notice>
        ) : null}
        {formNeeded && request !== undefined ? (
          <RequestPanel rules={rules} request={request} profile={profile} now={now.getTime()} />
        ) : null}
        {/* On form days, checking out needs the approval first: the panel above comes first. */}
        {closed === "before" && (!formNeeded || approved) ? (
          <Notice>
            <strong>Not open yet.</strong> You can check out from {formatTime(rules.opens_at)}.
            Reload this page then.
          </Notice>
        ) : null}
        {closed === null && (!formNeeded || approved) ? <CheckOutForm /> : null}
      </>
    );
  }

  return (
    <section aria-labelledby="checkout-heading" className="flex flex-col gap-6">
      <div>
        <p className="font-display text-lg text-muted">Hi {user.name.split(" ")[0]},</p>
        <h1 id="checkout-heading" className="font-display text-title text-ink">
          Heading out?
        </h1>
      </div>
      <Gate className="mx-auto w-full max-w-[16rem]" />
      {body}
    </section>
  );
}
