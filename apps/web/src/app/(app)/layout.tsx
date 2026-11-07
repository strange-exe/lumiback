import Link from "next/link";
import type { ReactNode } from "react";

import { SignOutButton } from "@/features/auth/components/SignOutButton";
import { ViewAsBanner } from "@/features/developer/components/ViewAsBanner";
import type { TargetId } from "@/features/tour/steps";
import { Tour } from "@/features/tour/Tour";
import { CURRENT } from "@/lib/changelog";
import { requireUser } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/types";

const NAV: readonly { href: string; label: string; tour?: TargetId }[] = [
  { href: "/home", label: "Today" },
  { href: "/history", label: "History", tour: "nav-history" },
  { href: "/share", label: "Share", tour: "nav-share" },
];

export default async function AppLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  const { user, viewingAs } = await requireUser();

  return (
    <>
      {viewingAs ? <ViewAsBanner role={viewingAs} /> : null}
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-5">
        <header className="flex items-center justify-between gap-3 py-4">
          <Link href="/home" className="font-display text-xl text-accent">
            Lumiback
          </Link>
          <nav aria-label="Main" className="flex items-center text-sm">
            {[
              ...NAV,
              ...(user.role !== "student"
                ? [{ href: "/admin", label: ROLE_LABEL[user.role] }]
                : []),
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                data-tour={item.tour}
                className="flex min-h-11 items-center rounded-control px-3 font-bold text-ink hover:bg-accent-soft"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="flex-1 pb-12 pt-2">{children}</main>
        <footer className="flex flex-col gap-1 border-t border-line py-4 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <span className="min-w-0 truncate">Signed in as {user.name}</span>
          <div className="-mx-3 flex items-center">
            {[
              { href: "/account", label: "Account", tour: "nav-account" },
              { href: "/privacy", label: "Privacy" },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                data-tour={item.tour}
                className="flex min-h-11 items-center rounded-control px-3 font-bold text-accent hover:bg-accent-soft"
              >
                {item.label}
              </Link>
            ))}
            <SignOutButton className="min-h-11 rounded-control px-3 font-bold text-accent hover:bg-accent-soft" />
          </div>
        </footer>
      </div>
      {/* The student tour; the hostel office has its own in /admin (and none while viewing as). */}
      <Tour
        userId={user.id}
        audience="student"
        current={CURRENT.version}
        enabled={!viewingAs && user.role === "student"}
      />
    </>
  );
}
