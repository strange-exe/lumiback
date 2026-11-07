import "server-only";

import { cookies, headers } from "next/headers";

import { ApiError, reachBackend, readableDetail } from "@/lib/api-error";
import { clientIpFrom, visitorHeaders } from "@/lib/client-ip";
import { BACKEND_URL, INTERNAL_API_SECRET, IP_TRUST } from "@/lib/config";
import { FAULT_HEADER, faultsEnabled, shouldFail } from "@/lib/test-faults";
import { VIEW_AS_COOKIE, viewAsHeaders } from "@/lib/view-as";

export { ApiError };

interface CallOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  token?: string | null;
  /** A code-joined guest's token (header only: never in a URL, which ends up in logs). */
  guestToken?: string | null;
  /** Real client IP, so the backend's per-IP limits apply per student, not per web server. */
  clientIp?: string | null;
  /**
   * Act as the signed-in developer even while they view as another role (no X-View-As-Role
   * header): for asking who they really are once the API refused their view.
   */
  asSelf?: boolean;
}

/** Human-readable message from a FastAPI error body (string detail or validation list). */
function detailOf(payload: unknown, status: number): string {
  if (payload && typeof payload === "object" && "detail" in payload) {
    const detail = (payload as { detail: unknown }).detail;
    if (typeof detail === "string") return readableDetail(status, detail);
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: unknown };
      if (typeof first.msg === "string") return first.msg.replace(/^Value error, /, "");
    }
  }
  if (status === 429) return "Too many attempts. Wait a moment and try again.";
  return "Something went wrong. Try again.";
}

/** E2E only (see test-faults.ts): fail this call if the test asked for it. */
async function injectedFault(path: string): Promise<boolean> {
  try {
    return shouldFail(path, (await headers()).get(FAULT_HEADER));
  } catch {
    return false; // outside a request (no headers to read)
  }
}

/** The view-as role cookie of the request being served (none outside a request). */
async function viewAsCookie(): Promise<string | undefined> {
  try {
    return (await cookies()).get(VIEW_AS_COOKIE)?.value;
  } catch {
    return undefined;
  }
}

async function send(path: string, options: CallOptions): Promise<Response> {
  const faults = faultsEnabled({
    NODE_ENV: process.env.NODE_ENV,
    E2E_FAULTS: process.env.E2E_FAULTS,
  });
  if (faults && (await injectedFault(path))) {
    throw new ApiError(503, "Test failure requested by the e2e suite.");
  }
  const requestHeaders: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) requestHeaders["Content-Type"] = "application/json";
  if (options.token) requestHeaders.Authorization = `Bearer ${options.token}`;
  if (options.guestToken) requestHeaders["X-Guest-Token"] = options.guestToken;
  if (options.token) {
    Object.assign(
      requestHeaders,
      viewAsHeaders({
        token: options.token,
        cookie: await viewAsCookie(),
        asSelf: options.asSelf,
      }),
    );
  }
  Object.assign(requestHeaders, visitorHeaders(options.clientIp ?? null, INTERNAL_API_SECRET));

  // No timeout of our own: on the free host a cold start can hold a request for up to a minute.
  return reachBackend(() =>
    fetch(`${BACKEND_URL}${path}`, {
      method: options.method ?? "GET",
      headers: requestHeaders,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
    }),
  );
}

/**
 * The backend's response as it came, body unread, for a Route Handler to pass straight on
 * (e.g. a file download). Errors still throw ApiError with a safe message.
 */
export async function streamBackend(path: string, options: CallOptions = {}): Promise<Response> {
  const response = await send(path, options);
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new ApiError(response.status, detailOf(payload, response.status));
  }
  return response;
}

export async function callBackend<T>(path: string, options: CallOptions = {}): Promise<T> {
  const response = await send(path, options);

  if (response.status === 204 || response.status === 202) return undefined as T;
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, detailOf(payload, response.status));
  return payload as T;
}

/** The visitor's IP as set by our edge proxy, for Server Actions/Components. */
export async function visitorIp(): Promise<string | null> {
  return clientIpFrom(await headers(), IP_TRUST);
}
