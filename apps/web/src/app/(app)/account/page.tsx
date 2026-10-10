import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { DeleteAccountForm } from "@/features/account/DeleteAccountForm";
import { OutingDetails } from "@/features/account/OutingDetails";
import { outingsApi } from "@/features/outings/api";
import { formatDate } from "@/features/outings/time";
import { requireUser } from "@/lib/session";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/support";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage(): Promise<ReactNode> {
  const { user, token } = await requireUser();
  const [profile, hostels] = await Promise.all([
    outingsApi.profile(token),
    outingsApi.hostels(token),
  ]);
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
            <dt className="text-muted">{label}</dt>
            <dd className="break-all font-bold text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      <OutingDetails profile={profile} hostels={hostels} />
      <div className="flex flex-col gap-2 text-muted">
        <p>
          Need help?{" "}
          <a
            href={SUPPORT_MAILTO}
            className="font-bold text-accent underline-offset-4 hover:underline"
          >
            Email {SUPPORT_EMAIL}
          </a>{" "}
          and you&apos;ll get a reply in your inbox. If it&apos;s urgent, call your hostel office.
        </p>
        <p>
          How your data is handled:{" "}
          <Link
            href="/privacy"
            className="font-bold text-accent underline-offset-4 hover:underline"
          >
            privacy notice
          </Link>
          .
        </p>
      </div>
      <DeleteAccountForm />
    </section>
  );
}
