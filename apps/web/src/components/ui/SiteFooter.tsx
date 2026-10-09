import Link from "next/link";
import type { ReactNode } from "react";

import { CURRENT } from "@/lib/changelog";

const link = "font-bold text-accent underline-offset-4 hover:underline";

/** Public pages' footer: who runs it, the version, and where the data promises are written. */
export function SiteFooter({ className = "" }: { className?: string }): ReactNode {
  return (
    <footer
      className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line py-5 text-sm text-muted ${className}`}
    >
      <span>&copy; {new Date().getFullYear()} Lumiback</span>
      <span className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Link href="/whats-new" className={link}>
          Version {CURRENT.version}
        </Link>
        <Link href="/privacy" className={link}>
          Privacy
        </Link>
      </span>
    </footer>
  );
}
