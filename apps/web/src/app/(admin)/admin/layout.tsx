import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { signOut } from "@/features/auth/actions";
import { AdminNav } from "@/features/admin/components/AdminNav";
import { requireAdmin } from "@/lib/session";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin · Lumiback" },
  robots: { index: false, follow: false },
};

/** Wardens and security: the gate register. Students get a 404 (see requireAdmin). */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  const { user } = await requireAdmin();
  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 sm:px-6">
      <header className="flex flex-col gap-3 border-b border-line py-4">
        <div className="flex items-center justify-between gap-3">
          <Link href="/admin" className="flex items-center gap-2">
            <span className="font-display text-xl text-ink">Lumiback</span>
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-bold text-accent">
              Admin
            </span>
          </Link>
          <div className="flex items-center gap-1 text-sm">
            <span className="hidden max-w-48 truncate text-muted sm:inline">{user.name}</span>
            <Link
              href="/home"
              className="flex min-h-11 items-center rounded-control px-3 font-bold text-accent hover:bg-accent-soft"
            >
              My app
            </Link>
            <form action={signOut}>
              <button
                type="submit"
                className="min-h-11 rounded-control px-3 font-bold text-accent hover:bg-accent-soft"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
        <AdminNav />
      </header>
      <main className="flex-1 py-6 sm:py-8">{children}</main>
    </div>
  );
}
