import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Gate } from "@/components/illustrations/Gate";
import { outingsApi } from "@/features/outings/api";
import { CheckOutForm } from "@/features/outings/components/CheckOutForm";
import { OutView } from "@/features/outings/components/OutView";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Today" };

export default async function HomePage(): Promise<ReactNode> {
  const { user, token } = await requireUser();
  const outing = await outingsApi.current(token);

  if (outing) return <OutView outing={outing} serverNow={new Date().toISOString()} />;

  return (
    <section aria-labelledby="checkout-heading" className="flex flex-col gap-6">
      <div>
        <p className="font-display text-lg text-muted">Hi {user.name.split(" ")[0]},</p>
        <h1 id="checkout-heading" className="font-display text-title text-ink">
          Heading out?
        </h1>
      </div>
      <Gate className="mx-auto w-full max-w-[16rem]" />
      <CheckOutForm />
    </section>
  );
}
