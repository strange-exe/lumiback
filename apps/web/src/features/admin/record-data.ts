import "server-only";

import { notFound } from "next/navigation";
import { cache } from "react";

import { adminApi } from "@/features/admin/api";
import { ApiError } from "@/lib/api-error";
import type { StudentRecord } from "@/lib/types";

/**
 * The top of a student's record, read once per request: the record's layout reads it first (a
 * student this office doesn't look after becomes a real 404 there, outside the page's loading
 * boundary) and the page reuses it.
 */
export const studentRecordOr404 = cache(
  async (token: string, id: string): Promise<StudentRecord> => {
    try {
      return await adminApi.studentRecord(token, id);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) notFound();
      throw error;
    }
  },
);
