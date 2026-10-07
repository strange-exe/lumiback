import Link from "next/link";
import type { ReactNode } from "react";

import { SiteFooter } from "@/components/ui/SiteFooter";

/** Frame for register/verify/join: the wordmark keeps students oriented and offers a way back. */
export function AuthShell({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-5">
      <header className="flex h-16 items-center">
        <Link href="/" className="font-display text-xl text-accent">
          Lumiback
        </Link>
      </header>
      <main className="flex flex-1 flex-col justify-center gap-6 pb-10 pt-4">{children}</main>
      <SiteFooter />
    </div>
  );
}
