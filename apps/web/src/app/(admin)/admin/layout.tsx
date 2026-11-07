import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { SignOutButton } from "@/features/auth/components/SignOutButton";
import { AdminNav } from "@/features/admin/components/AdminNav";
import { ViewAsBanner } from "@/features/developer/components/ViewAsBanner";
import { Tour } from "@/features/tour/Tour";
import { TourReplayButton } from "@/features/tour/TourReplayButton";
import { CURRENT } from "@/lib/changelog";
import { requireStaff } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/types";

export const metadata: Metadata = {
  title: { default: "Hostel office", template: "%s · Hostel office · Lumiback" },
  robots: { index: false, follow: false },
};

/** The hostel office: admins and developers (every hostel, plus setup) and wardens (their
 * hostels). Students get a 404 (see requireStaff); setup pages also call requireAdmin. While a
 * developer views as a role, the office is that role's (its sections, its 404s), a banner says
 * so and the tour stays off. */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  const { user, viewingAs, developer } = await requireStaff();
  const action = "min-h-11 rounded-control px-3 font-bold text-accent hover:bg-accent-soft";
  return (
    <>
      {viewingAs ? <ViewAsBanner role={viewingAs} /> : null}
      <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 sm:px-6">
        <header className="flex flex-col gap-3 border-b border-line py-4">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <Link href="/admin" className="flex items-center gap-2">
              <span className="font-display text-xl text-ink">Lumiback</span>
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-bold text-accent">
                {ROLE_LABEL[user.role]}
              </span>
            </Link>
            <div className="flex items-center gap-1 text-sm">
              <span className="hidden max-w-48 truncate text-muted sm:inline">{user.name}</span>
              {viewingAs ? null : (
                <TourReplayButton
                  to="/admin"
                  pointedAt
                  label="Take the tour again"
                  className={action}
                >
                  Tour
                </TourReplayButton>
              )}
              <Link href="/home" className={`flex items-center ${action}`}>
                My app
              </Link>
              <SignOutButton className={action} />
            </div>
          </div>
          {/* The View as menu sits in the nav for a developer as themselves; while viewing,
              it's in the banner, and the nav is the viewed role's. */}
          <AdminNav role={user.role} viewAs={developer && !viewingAs} />
        </header>
        <main className="flex-1 py-6 sm:py-8">{children}</main>
      </div>
      <Tour userId={user.id} audience="staff" current={CURRENT.version} enabled={!viewingAs} />
    </>
  );
}
