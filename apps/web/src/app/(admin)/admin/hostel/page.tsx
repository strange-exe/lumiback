import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { adminApi } from "@/features/admin/api";
import { HostelContactForm } from "@/features/admin/components/HostelContactForm";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "My hostel" };

/** A warden's hostels and the contact shown when one of their students is late. */
export default async function MyHostelPage(): Promise<ReactNode> {
  const { token, user } = await requireStaff();
  if (user.role === "admin") redirect("/admin/rules"); // admins edit every hostel there
  const hostels = await adminApi.myHostels(token);
  return (
    <section aria-labelledby="hostel-heading" className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 id="hostel-heading" className="font-display text-title text-ink">
          {hostels.length === 1 ? "My hostel" : "My hostels"}
        </h1>
        <p className="max-w-[65ch] text-muted">
          You see outing requests, escalations, who&apos;s out and gate scans for{" "}
          {hostels.length === 1 ? "this hostel's" : "these hostels'"} students only. The contact
          below is shown when one of them is late and doesn&apos;t answer. Outing hours and holidays
          are set by an admin.
        </p>
      </div>
      {hostels.length === 0 ? (
        <p className="rounded-sheet border border-dashed border-line px-5 py-8 text-center text-muted">
          No hostels are assigned to you yet. Ask an admin to add you as a hostel&apos;s warden.
        </p>
      ) : (
        hostels.map((hostel) => <HostelContactForm key={hostel.id} hostel={hostel} />)
      )}
    </section>
  );
}
