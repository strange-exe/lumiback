import type { ReactNode } from "react";

import { requireAdmin } from "@/lib/session";

/**
 * Checks the role here, outside this segment's loading boundary (loading.tsx wraps the page,
 * not this layout), so anyone but an admin or developer gets a real 404 instead of a streamed 200.
 */
export default async function AuditLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  await requireAdmin();
  return children;
}
