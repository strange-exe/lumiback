import type { ReactNode } from "react";

import { requireRulesEditor } from "@/lib/session";

/**
 * Checks the role here, outside this segment's loading boundary (loading.tsx wraps the page,
 * not this layout), so a warden still gets a real 404 instead of a streamed 200.
 */
export default async function RulesLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  await requireRulesEditor();
  return children;
}
