import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { DeleteAccountForm } from "@/features/account/DeleteAccountForm";
import { formatDate } from "@/features/outings/time";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage(): Promise<ReactNode> {
  const { user } = await requireUser();
  const rows: [string, string][] = [
    ["Name", user.name],
    ["Email", user.email],
    ["Roll number", user.roll_no ?? "Not added"],
    ["Member since", formatDate(user.created_at)],
  ];

  return (
    <section aria-labelledby="account-heading" className="flex flex-col gap-8">
      <h1 id="account-heading" className="font-display text-title text-ink">
        Account
      </h1>
      <dl className="flex flex-col divide-y divide-line rounded-sheet border border-line bg-surface">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-wrap justify-between gap-x-6 gap-y-1 px-5 py-4">
            <dt className="text-stone">{label}</dt>
            <dd className="break-all font-bold text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-stone">
        How your data is handled:{" "}
        <Link href="/privacy" className="font-bold text-pine underline-offset-4 hover:underline">
          privacy notice
        </Link>
        .
      </p>
      <DeleteAccountForm />
    </section>
  );
}
