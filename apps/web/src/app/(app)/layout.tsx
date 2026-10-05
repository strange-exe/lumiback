import Link from "next/link";
import type { ReactNode } from "react";

import { signOut } from "@/features/auth/actions";
import { requireUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  const { user } = await requireUser();
  const firstName = user.name.split(" ")[0];

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-5">
      <header className="flex items-center justify-between gap-4 py-4">
        <Link href="/home" className="font-display text-xl text-pine">
          Lumiback
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 text-sm">
          <Link
            href="/home"
            className="rounded-control px-3 py-2 font-bold text-ink hover:bg-pine-soft"
          >
            Today
          </Link>
          <Link
            href="/history"
            className="rounded-control px-3 py-2 font-bold text-ink hover:bg-pine-soft"
          >
            History
          </Link>
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-control px-3 py-2 text-stone hover:bg-pine-soft hover:text-ink"
            >
              Sign out
            </button>
          </form>
        </nav>
      </header>
      <p className="sr-only">Signed in as {firstName}</p>
      <main className="flex-1 pb-12 pt-2">{children}</main>
    </div>
  );
}
