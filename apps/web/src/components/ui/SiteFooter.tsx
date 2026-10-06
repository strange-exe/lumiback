import Link from "next/link";
import type { ReactNode } from "react";

/** Public pages' footer: who runs it, and where the data promises are written down. */
export function SiteFooter({ className = "" }: { className?: string }): ReactNode {
  return (
    <footer
      className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line py-5 text-sm text-stone ${className}`}
    >
      <span>&copy; {new Date().getFullYear()} Lumiback</span>
      <Link href="/privacy" className="font-bold text-pine underline-offset-4 hover:underline">
        Privacy
      </Link>
    </footer>
  );
}
