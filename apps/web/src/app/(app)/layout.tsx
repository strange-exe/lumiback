import Link from "next/link";
import type { ReactNode } from "react";

import { signOut } from "@/features/auth/actions";
import { shareApi } from "@/features/share/api";
import { LiveBar } from "@/features/share/components/LiveBar";
import { ShareProvider } from "@/features/share/ShareProvider";
import { requireUser } from "@/lib/session";

const NAV = [
  { href: "/home", label: "Today" },
  { href: "/history", label: "History" },
  { href: "/share", label: "Share" },
] as const;

export default async function AppLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  const { user, token } = await requireUser();
  const liveShare = await shareApi.activeTabShare(token);

  return (
    <ShareProvider initial={liveShare}>
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-5">
        <header className="flex items-center justify-between gap-3 py-4">
          <Link href="/home" className="font-display text-xl text-pine">
            Lumiback
          </Link>
          <nav aria-label="Main" className="flex items-center text-sm">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex min-h-11 items-center rounded-control px-3 font-bold text-ink hover:bg-pine-soft"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </header>
        <LiveBar />
        <main className="flex-1 pb-12 pt-2">{children}</main>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-4 text-sm text-stone">
          <span>Signed in as {user.name}</span>
          <form action={signOut}>
            <button
              type="submit"
              className="min-h-11 rounded-control px-3 font-bold text-pine hover:bg-pine-soft"
            >
              Sign out
            </button>
          </form>
        </footer>
      </div>
    </ShareProvider>
  );
}
