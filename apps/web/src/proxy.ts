import { NextResponse, type NextRequest } from "next/server";

import { clientIpFrom, visitorHeaders } from "@/lib/client-ip";
import { BACKEND_URL, INTERNAL_API_SECRET, IP_TRUST } from "@/lib/config";
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

/**
 * "rejected": the backend refused the token (spent, expired, revoked), so the login is over.
 * "unavailable": the backend couldn't answer (asleep on the free tier, restarting, overloaded):
 * the token may still be good, so it's kept and the next request tries again.
 */
type Refresh = { kind: "ok"; tokens: TokenPair } | { kind: "rejected" } | { kind: "unavailable" };

const recent = new Map<string, { result: Promise<Refresh>; at: number }>();

function refreshOnce(token: string, clientIp: string | null): Promise<Refresh> {
  const now = Date.now();
  for (const [key, entry] of recent) if (now - entry.at > REUSE_WINDOW_MS) recent.delete(key);

  const cached = recent.get(token);
  if (cached) return cached.result;

  const result: Promise<Refresh> = fetch(`${BACKEND_URL}/auth/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...visitorHeaders(clientIp, INTERNAL_API_SECRET),
    },
    body: JSON.stringify({ refresh_token: token }),
    cache: "no-store",
  })
    .then(async (r): Promise<Refresh> => {
      if (r.ok) return { kind: "ok", tokens: (await r.json()) as TokenPair };
      // 4xx other than rate limiting means the backend looked at the token and said no.
      return r.status >= 400 && r.status < 500 && r.status !== 429
        ? { kind: "rejected" }
        : { kind: "unavailable" };
    })
    .catch((): Refresh => ({ kind: "unavailable" }));
  recent.set(token, { result, at: now });
  // Requests arriving together still share this attempt, but a failure isn't remembered: the
  // next request after it tries again instead of reusing "unavailable" for 30 seconds.
  void result.then((r) => {
    if (r.kind === "unavailable" && recent.get(token)?.result === result) recent.delete(token);
  });
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

  const clientIp = clientIpFrom(request.headers, IP_TRUST);
  const outcome = await refreshOnce(refresh, clientIp);
  // The backend is down for a moment: keep the refresh cookie (this request goes on without an
  // access token) instead of signing the person out.
  if (outcome.kind === "unavailable") return NextResponse.next();
  const tokens = outcome.kind === "ok" ? outcome.tokens : null;

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
  matcher: [
    "/((?!_next/static|_next/image|icon.svg|.*\\.(?:svg|png|ico|webp|avif|webmanifest)$).*)",
  ],
};
