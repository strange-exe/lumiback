import { NextResponse, type NextRequest } from "next/server";

import { COOKIE_BASE } from "@/lib/cookies";
import { endTarget, VIEW_AS_COOKIE } from "@/lib/view-as";

/**
 * Clears a View as role the API no longer honours ("developers only", "unknown role": session.ts
 * redirects here, since pages can't change cookies while they render). It only ever removes the
 * cookie, which narrows what the browser can do, so a plain GET is safe. `to` is one of a fixed
 * list of pages, never a free URL.
 */
export function GET(request: NextRequest): NextResponse {
  const to = endTarget(request.nextUrl.searchParams.get("to"));
  const response = NextResponse.redirect(new URL(to, request.url), 303);
  response.cookies.set(VIEW_AS_COOKIE, "", { ...COOKIE_BASE, maxAge: 0 });
  return response;
}
