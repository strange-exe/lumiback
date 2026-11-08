import { NextResponse, type NextRequest } from "next/server";

import { COOKIE_BASE } from "@/lib/cookies";
import {
  chosenFrom,
  extrasFrom,
  FILTERS_COOKIE,
  FILTERS_MAX_AGE,
  filterView,
  pageHref,
  parseFilters,
  remember,
  serializeFilters,
} from "@/lib/filters";

/**
 * A filter link or form on the hostel office's lists: remembers the choice in this browser
 * (lib/filters.ts), then opens the page with it in the address. A Route Handler because pages
 * can't set cookies while they render. A GET is fine here: it only changes which list this
 * browser opens next, never data, and the page re-checks everything (the API decides what the
 * signed-in person may see). The destination is built from a fixed list of pages and checked
 * values, never taken from the request, so it can't redirect anywhere else.
 */
export function GET(request: NextRequest): NextResponse {
  const query = Object.fromEntries(request.nextUrl.searchParams);
  const view = filterView(query.view);
  if (view === null) return NextResponse.redirect(new URL("/admin", request.url), 303);
  const values = chosenFrom(view, query);
  const kept = remember(parseFilters(request.cookies.get(FILTERS_COOKIE)?.value), view, values);
  // A search or date range rides along to the page but isn't remembered.
  const to = pageHref(view, values, extrasFrom(view, query));
  const response = NextResponse.redirect(new URL(to, request.url), 303);
  // A link from another site still opens the list, but doesn't change what this browser
  // remembers (browsers without Sec-Fetch-Site send none, and are treated as our own pages).
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") return response;
  if (Object.keys(kept).length > 0) {
    response.cookies.set(FILTERS_COOKIE, serializeFilters(kept), {
      ...COOKIE_BASE,
      maxAge: FILTERS_MAX_AGE,
    });
  } else {
    response.cookies.set(FILTERS_COOKIE, "", { ...COOKIE_BASE, maxAge: 0 });
  }
  return response;
}
