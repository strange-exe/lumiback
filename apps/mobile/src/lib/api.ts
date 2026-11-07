import { API_URL } from "@/lib/config";
import {
  accessToken,
  clearTokens,
  refresh,
  sessionGeneration,
  SessionUnavailable,
} from "@/lib/session";
import { clearViewAs, loadViewAs, refusesViewAs, viewAsHeaders } from "@/lib/view-as";

/**
 * A structured error detail: `{code, message, ...}` (e.g. the gate's "stale_outing"). Most
 * errors send a plain sentence instead, and have none.
 */
export interface Problem {
  code: string;
  message: string;
  [key: string]: unknown;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly problem: Problem | null = null,
  ) {
    super(`${status}: ${detail}`);
  }
}

const OFFLINE = "Can't reach Lumiback. Check your connection and try again.";

/** The structured detail of an error body, or null when `detail` isn't `{code, message}`. */
export function problemOf(payload: unknown): Problem | null {
  if (!payload || typeof payload !== "object" || !("detail" in payload)) return null;
  const detail = (payload as { detail: unknown }).detail;
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const { code, message } = detail as { code?: unknown; message?: unknown };
  if (typeof code !== "string" || typeof message !== "string") return null;
  return { ...(detail as Record<string, unknown>), code, message };
}

/** Human-readable message from a FastAPI error body (string detail, `{code, message}`, or
 * validation list). */
export function detailOf(payload: unknown, status: number): string {
  if (payload && typeof payload === "object" && "detail" in payload) {
    const detail = (payload as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    const problem = problemOf(payload);
    if (problem) return problem.message;
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: unknown };
      if (typeof first.msg === "string") return first.msg.replace(/^Value error, /, "");
    }
  }
  if (status === 429) return "Too many attempts. Wait a moment and try again.";
  return "Something went wrong. Try again.";
}

interface Options {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Send the signed-in student's token (default). Sign-in and sign-up calls pass false. */
  auth?: boolean;
  /**
   * Without the View as header, even while a developer views as another role: the location
   * service sending for the phone's own share (a read-only view would refuse it).
   */
  self?: boolean;
}

async function send(
  path: string,
  options: Options,
  token: string | null,
  extra: Record<string, string> = {},
): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json", ...extra };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    return await fetch(`${API_URL}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, OFFLINE);
  }
}

/** A token, null when signed out; can't-renew-right-now is a network failure (status 0). */
async function renewing(get: () => Promise<string | null>): Promise<string | null> {
  try {
    return await get();
  } catch (error) {
    if (error instanceof SessionUnavailable) throw new ApiError(0, OFFLINE);
    throw error;
  }
}

/** Calls the API; on a 401 it refreshes once and retries, then signs out if still refused. */
export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const auth = options.auth ?? true;
  const began = sessionGeneration(); // a refusal only ends the session this request began in
  let token = auth ? await renewing(accessToken) : null;
  if (auth && !token) throw new ApiError(401, "Please sign in again.");
  // Viewing as a role (developers): every signed-in request names it.
  const viewAs = auth && !options.self ? await loadViewAs() : null;
  const extra = viewAsHeaders(viewAs);

  let response = await send(path, options, token, extra);
  if (auth && response.status === 401) {
    // Another sign-in (or a sign-out) since this request began: never renew or retry it with
    // the next session's tokens.
    const stale = (): boolean => sessionGeneration() !== began;
    if (stale()) throw new ApiError(401, "Please sign in again.");
    token = await renewing(refresh);
    if (!token || stale()) throw new ApiError(401, "Please sign in again.");
    response = await send(path, options, token, extra);
    if (response.status === 401) {
      if (sessionGeneration() === began) await clearTokens();
      throw new ApiError(401, "Please sign in again.");
    }
  }

  if (response.status === 204 || response.status === 202) return undefined as T;
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = detailOf(payload, response.status);
    // Not a developer (any more), or a role the server doesn't know: stop viewing, here too.
    // Read-only refusals ("Read-only while viewing as another role") reach the screen as
    // they are.
    if (viewAs && refusesViewAs(response.status, detail)) await clearViewAs(viewAs);
    throw new ApiError(response.status, detail, problemOf(payload));
  }
  return payload as T;
}
