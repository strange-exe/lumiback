import { NextResponse, type NextRequest } from "next/server";

import { clientIpFrom } from "@/lib/client-ip";
import { BACKEND_URL } from "@/lib/config";
import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE,
  COOKIE_BASE,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE,
} from "@/lib/cookies";
import type { TokenPair } from "@/lib/types";

/**
 * Refresh results keyed by the refresh token that was spent.
 *
 * The backend revokes a whole login if a spent refresh token is ever presented again. Requests
 * that arrive together (or before the browser has stored the new cookies) all carry the same old
 * token, so they must share ONE refresh instead of each spending it. Results are kept briefly for
 * stragglers. Per server process; a multi-instance deploy needs sticky sessions or a shared store.
 */
const REUSE_WINDOW_MS = 30_000;
const recent = new Map<string, { result: Promise<TokenPair | null>; at: number }>();

function refreshOnce(token: string, clientIp: string | null): Promise<TokenPair | null> {
  const now = Date.now();
  for (const [key, entry] of recent) if (now - entry.at > REUSE_WINDOW_MS) recent.delete(key);

  const cached = recent.get(token);
  if (cached) return cached.result;

  const result = fetch(`${BACKEND_URL}/auth/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(clientIp ? { "X-Forwarded-For": clientIp } : {}),
    },
    body: JSON.stringify({ refresh_token: token }),
    cache: "no-store",
  })
    .then(async (r) => (r.ok ? ((await r.json()) as TokenPair) : null))
    .catch(() => null);
  recent.set(token, { result, at: now });
  return result;
}

function cookieHeader(request: NextRequest, overrides: Record<string, string | null>): string {
  const jar = new Map(request.cookies.getAll().map((c) => [c.name, c.value]));
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) jar.delete(name);
    else jar.set(name, value);
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const access = request.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
  if (access || !refresh) return NextResponse.next();

  const clientIp = clientIpFrom(request.headers);
  const tokens = await refreshOnce(refresh, clientIp);

  // Downstream pages and actions must see the updated cookies on THIS request...
  const headers = new Headers(request.headers);
  headers.set(
    "cookie",
    cookieHeader(request, {
      [ACCESS_COOKIE]: tokens?.access_token ?? null,
      [REFRESH_COOKIE]: tokens?.refresh_token ?? null,
    }),
  );
  const response = NextResponse.next({ request: { headers } });

  // ...and the browser must store them for the next one.
  if (tokens) {
    response.cookies.set(ACCESS_COOKIE, tokens.access_token, {
      ...COOKIE_BASE,
      maxAge: ACCESS_MAX_AGE,
    });
    response.cookies.set(REFRESH_COOKIE, tokens.refresh_token, {
      ...COOKIE_BASE,
      maxAge: REFRESH_MAX_AGE,
    });
  } else {
    response.cookies.delete(REFRESH_COOKIE); // spent, expired, or revoked: sign in again
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.svg|.*\\.(?:svg|png|ico|webp|avif)$).*)"],
};
