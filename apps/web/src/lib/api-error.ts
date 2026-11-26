/**
 * The backend client's error type, and how a request that never got an answer is reported.
 * Pure (no Next.js imports) so it runs under `node --test`; backend.ts re-exports ApiError.
 */

import { READ_ONLY } from "./view-as.ts";

export class ApiError extends Error {
  // Plain fields, not parameter properties: `node --test` strips types and can't run those.
  readonly status: number;
  readonly detail: string;
  /** A structured detail's `code` (e.g. "login_locked"); null for a plain sentence. */
  readonly code: string | null;

  constructor(status: number, detail: string, code: string | null = null) {
    super(`${status}: ${detail}`);
    this.status = status;
    this.detail = detail;
    this.code = code;
  }
}

/**
 * The ApiError for an error response body: a string detail, a structured `{code, message}`, or
 * FastAPI's validation list. Anything else falls back to a safe sentence for the status.
 */
export function errorFrom(status: number, payload: unknown): ApiError {
  const detail =
    payload && typeof payload === "object" && "detail" in payload
      ? (payload as { detail: unknown }).detail
      : undefined;
  if (typeof detail === "string") return new ApiError(status, readableDetail(status, detail));
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const { code, message } = detail as { code?: unknown; message?: unknown };
    if (typeof code === "string" && typeof message === "string") {
      return new ApiError(status, message, code);
    }
  }
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0] as { msg?: unknown };
    if (typeof first.msg === "string") {
      return new ApiError(status, first.msg.replace(/^Value error, /, ""));
    }
  }
  // Every 429 the API sends carries its own sentence (above). One without it was sent by the
  // hosting in front of the API (Render limits inbound requests), so the person's own attempts
  // weren't counted and mustn't be blamed (owner's report, 2026-11-26).
  if (status === 429) return new ApiError(status, SERVER_BUSY);
  return new ApiError(status, "Something went wrong. Try again.");
}

/** What a form shows when the hosting, not the API, turned a request away as too many. */
export const SERVER_BUSY = "Lumiback's server is busy right now. Wait a minute and try again.";

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
