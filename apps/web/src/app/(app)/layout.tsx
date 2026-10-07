import Link from "next/link";
import type { ReactNode } from "react";

import { signOut } from "@/features/auth/actions";
import { requireUser } from "@/lib/session";

const NAV = [
  { href: "/home", label: "Today" },
  { href: "/history", label: "History" },
  { href: "/share", label: "Share" },
] as const;

export default async function AppLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  const { user } = await requireUser();

  return (
    <>
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-5">
        <header className="flex items-center justify-between gap-3 py-4">
          <Link href="/home" className="font-display text-xl text-accent">
            Lumiback
          </Link>
          <nav aria-label="Main" className="flex items-center text-sm">
            {[...NAV, ...(user.role === "admin" ? [{ href: "/admin", label: "Admin" }] : [])].map(
              (item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex min-h-11 items-center rounded-control px-3 font-bold text-ink hover:bg-accent-soft"
                >
                  {item.label}
                </Link>
              ),
            )}
          </nav>
        </header>
        <main className="flex-1 pb-12 pt-2">{children}</main>
        <footer className="flex flex-col gap-1 border-t border-line py-4 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <span className="min-w-0 truncate">Signed in as {user.name}</span>
          <div className="-mx-3 flex items-center">
            {[
              { href: "/account", label: "Account" },
              { href: "/privacy", label: "Privacy" },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex min-h-11 items-center rounded-control px-3 font-bold text-accent hover:bg-accent-soft"
              >
                {item.label}
              </Link>
            ))}
            <form action={signOut}>
              <button
                type="submit"
                className="min-h-11 rounded-control px-3 font-bold text-accent hover:bg-accent-soft"
              >
                Sign out
              </button>
            </form>
          </div>
        </footer>
      </div>
    </>
  );
}
