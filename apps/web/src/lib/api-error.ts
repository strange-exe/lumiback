/**
 * The backend client's error type, and how a request that never got an answer is reported.
 * Pure (no Next.js imports) so it runs under `node --test`; backend.ts re-exports ApiError.
 */

import { READ_ONLY } from "./view-as.ts";

export class ApiError extends Error {
  // Plain fields, not parameter properties: `node --test` strips types and can't run those.
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(`${status}: ${detail}`);
    this.status = status;
    this.detail = detail;
  }
}

/** What a form shows when the API didn't answer at all (DNS, refused connection, reset). */
export const UNREACHABLE = "Lumiback can't reach its server right now. Try again in a moment.";

/** What a form shows when a developer viewing as another role tries to change something. */
export const VIEW_AS_READ_ONLY =
  "Nothing was changed: you're viewing as another role, which is read-only. Use Stop in the banner at the top to make changes as yourself.";

/**
 * The words a form shows for an API refusal. Most details are written for people already; the
 * view-as refusal is reworded to say what happened and what to do.
 */
export function readableDetail(status: number, detail: string): string {
  if (status === 403 && detail === READ_ONLY) return VIEW_AS_READ_ONLY;
  return detail;
}

/**
 * Runs one request to the API. A rejected fetch (no answer at all) becomes a 503 ApiError, so
 * Server Actions return it as form state, keeping what was typed, instead of throwing to the
 * error page. Any answer, error statuses included, is returned as it came.
 */
export async function reachBackend(request: () => Promise<Response>): Promise<Response> {
  try {
    return await request();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, UNREACHABLE);
  }
}
