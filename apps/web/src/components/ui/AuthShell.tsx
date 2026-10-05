import Link from "next/link";
import type { ReactNode } from "react";

/** Frame for register/verify: the wordmark keeps students oriented and offers a way back. */
export function AuthShell({ children }: { children: ReactNode }): ReactNode {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-8 px-5 py-6">
      <Link href="/" className="self-start font-display text-xl text-pine">
        Lumiback
      </Link>
      <div className="flex flex-1 flex-col justify-center gap-6 pb-10">{children}</div>
    </main>
  );
}
