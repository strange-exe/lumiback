"use client";

import type { ReactNode } from "react";

import { ErrorPanel } from "@/components/ui/ErrorPanel";

/** An office page failed to load: shown inside the office header, so the nav still works. */
export default function AdminError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}): ReactNode {
  return (
    <ErrorPanel
      error={error}
      retry={retry}
      away={{ href: "/admin", label: "Go to the Register" }}
    />
  );
}
