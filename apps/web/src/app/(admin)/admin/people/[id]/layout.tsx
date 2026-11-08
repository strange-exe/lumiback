import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { recordId } from "@/features/admin/record";
import { studentRecordOr404 } from "@/features/admin/record-data";
import { requireStaff } from "@/lib/session";

/**
 * Checks the role and the student here, outside this segment's loading boundary (loading.tsx
 * wraps the page, not this layout), so a student, or a warden asking about another hostel's
 * student, gets a real 404 instead of a streamed 200.
 */
export default async function StudentRecordLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { token } = await requireStaff();
  const id = recordId((await params).id);
  if (id === null) notFound();
  await studentRecordOr404(token, id);
  return children;
}
