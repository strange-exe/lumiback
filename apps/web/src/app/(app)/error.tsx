"use client";

import type { ReactNode } from "react";

import { ErrorPanel } from "@/components/ui/ErrorPanel";

/** A page in the student app failed to load: shown inside the app's header and footer. */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}): ReactNode {
  return <ErrorPanel error={error} retry={retry} away={{ href: "/home", label: "Go to Today" }} />;
}
