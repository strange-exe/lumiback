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
  // Tighter on a phone, where the three share the name's row from 320 px (owner, 2026-11-26).
  const action =
    "min-h-11 min-w-11 shrink-0 whitespace-nowrap rounded-control px-2 font-bold text-accent hover:bg-accent-soft sm:px-3";
  return (
    <>
      {viewingAs ? <ViewAsBanner role={viewingAs} /> : null}
      <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 sm:px-6">
        <header className="flex flex-col gap-3 border-b border-line py-4">
          {/* One row whenever it fits. Below sm nothing shrinks, so wider text (text spacing, a
              bigger default font) wraps the actions under the name instead of off the screen;
              from sm the signed-in name truncates instead, so the row never wraps there. */}
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 sm:flex-nowrap sm:gap-x-3">
            {/* On a phone the role goes under the name (no room beside it); a pill beside it from sm. */}
            <Link
              href="/admin"
              className="flex shrink-0 flex-col sm:flex-row sm:items-center sm:gap-2"
            >
              <span className="font-display text-xl leading-7 text-ink">Lumiback</span>
              <span className="text-xs leading-4 font-bold text-accent sm:rounded-full sm:bg-accent-soft sm:px-2 sm:py-0.5">
                {ROLE_LABEL[user.role]}
              </span>
            </Link>
            <div className="ml-auto flex min-w-0 items-center text-sm sm:gap-1">
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
