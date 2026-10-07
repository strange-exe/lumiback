import { API_URL } from "@/lib/config";
import { accessToken, clearTokens, refresh } from "@/lib/session";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`${status}: ${detail}`);
  }
}

const OFFLINE = "Can't reach Lumiback. Check your connection and try again.";

/** Human-readable message from a FastAPI error body (string detail or validation list). */
export function detailOf(payload: unknown, status: number): string {
  if (payload && typeof payload === "object" && "detail" in payload) {
    const detail = (payload as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
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
}

async function send(path: string, options: Options, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
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

/** Calls the API; on a 401 it refreshes once and retries, then signs out if still refused. */
export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const auth = options.auth ?? true;
  let token = auth ? await accessToken() : null;
  if (auth && !token) throw new ApiError(401, "Please sign in again.");

  let response = await send(path, options, token);
  if (auth && response.status === 401) {
    token = await refresh();
    if (!token) throw new ApiError(401, "Please sign in again.");
    response = await send(path, options, token);
    if (response.status === 401) {
      await clearTokens();
      throw new ApiError(401, "Please sign in again.");
    }
  }

  if (response.status === 204 || response.status === 202) return undefined as T;
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, detailOf(payload, response.status));
  return payload as T;
}
