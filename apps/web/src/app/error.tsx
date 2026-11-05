"use client";

import type { ReactNode } from "react";

import { AuthShell } from "@/components/ui/AuthShell";
import { ErrorPanel } from "@/components/ui/ErrorPanel";

/**
 * Anything the route-level boundaries can't catch: public pages, and the app's and office's own
 * layouts (which check who is signed in). The root layout itself is global-error.tsx.
 */
export default function RootError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}): ReactNode {
  return (
    <AuthShell>
      <ErrorPanel error={error} retry={retry} away={{ href: "/", label: "Lumiback home" }} />
    </AuthShell>
  );
}
