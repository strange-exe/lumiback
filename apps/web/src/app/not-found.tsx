import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { Lantern } from "@/components/illustrations/Lantern";
import { AuthShell } from "@/components/ui/AuthShell";

export const metadata: Metadata = { title: "Page not found" };

/** Unknown links, and pages someone isn't allowed to see (the office answers students with this). */
export default function NotFound(): ReactNode {
  return (
    <AuthShell>
      <section
        aria-labelledby="not-found-heading"
        className="flex flex-col items-center gap-4 text-center"
      >
        <Lantern lit={false} className="h-24 w-20" />
        <h1 id="not-found-heading" className="font-display text-title text-ink">
          Page not found
        </h1>
        <p className="max-w-xs text-muted">
          This link may be old or mistyped, or the page isn&apos;t open to your account.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/home"
            className="flex min-h-12 items-center rounded-control bg-accent px-6 font-bold text-on-accent hover:brightness-110"
          >
            Go to Today
          </Link>
          <Link
            href="/"
            className="flex min-h-12 items-center rounded-control px-3 font-bold text-accent hover:bg-accent-soft"
          >
            Lumiback home
          </Link>
        </div>
      </section>
    </AuthShell>
  );
}
