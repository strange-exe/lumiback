import type { ReactNode } from "react";

import { requireDeveloper } from "@/lib/session";

/**
 * Checks the role here, outside this segment's loading boundary (loading.tsx wraps the page,
 * not this layout), so anyone but a developer as themselves gets a real 404, not a streamed 200.
 */
export default async function ErrorsLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  await requireDeveloper();
  return children;
}
