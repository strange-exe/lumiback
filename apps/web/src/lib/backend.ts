import "server-only";

import { headers } from "next/headers";

import { clientIpFrom } from "@/lib/client-ip";
import { BACKEND_URL } from "@/lib/config";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`${status}: ${detail}`);
  }
}

interface CallOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  token?: string | null;
  /** A code-joined guest's token (header only: never in a URL, which ends up in logs). */
  guestToken?: string | null;
  /** Real client IP, so the backend's per-IP limits apply per student, not per web server. */
  clientIp?: string | null;
}

/** Human-readable message from a FastAPI error body (string detail or validation list). */
function detailOf(payload: unknown, status: number): string {
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

export async function callBackend<T>(path: string, options: CallOptions = {}): Promise<T> {
  const requestHeaders: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) requestHeaders["Content-Type"] = "application/json";
  if (options.token) requestHeaders.Authorization = `Bearer ${options.token}`;
  if (options.guestToken) requestHeaders["X-Guest-Token"] = options.guestToken;
  if (options.clientIp) requestHeaders["X-Forwarded-For"] = options.clientIp;

  const response = await fetch(`${BACKEND_URL}${path}`, {
    method: options.method ?? "GET",
    headers: requestHeaders,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
  });

  if (response.status === 204 || response.status === 202) return undefined as T;
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, detailOf(payload, response.status));
  return payload as T;
}

/** The visitor's IP as set by our edge proxy, for Server Actions/Components. */
export async function visitorIp(): Promise<string | null> {
  return clientIpFrom(await headers());
}
