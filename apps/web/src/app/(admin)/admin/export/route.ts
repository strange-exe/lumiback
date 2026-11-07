import { NextResponse, type NextRequest } from "next/server";

import {
  exportBackPath,
  exportProblemFor,
  exportRangeProblem,
  type ExportProblem,
} from "@/features/admin/export";
import { visitorIp } from "@/lib/backend";
import { visitorHeaders } from "@/lib/client-ip";
import { BACKEND_URL, INTERNAL_API_SECRET } from "@/lib/config";
import { accessToken } from "@/lib/session";

/**
 * The register as CSV for a date range. A GET that changes nothing, so a plain form can point
 * here; the backend still checks the admin role and the range. When there is no file to give,
 * the admin goes back to the office page with the reason shown next to the form (never a bare
 * text page or a framework error).
 */
export async function GET(request: NextRequest): Promise<Response> {
  const token = await accessToken();
  if (!token) return NextResponse.redirect(new URL("/sign-in", request.url), 303);
  const from = request.nextUrl.searchParams.get("from") ?? "";
  const to = request.nextUrl.searchParams.get("to") ?? "";
  const back = (problem: ExportProblem) =>
    NextResponse.redirect(new URL(exportBackPath(problem, from, to), request.url), 303);

  const problem = exportRangeProblem(from, to);
  if (problem) return back(problem);

  let upstream: Response;
  try {
    upstream = await fetch(`${BACKEND_URL}/admin/outings.csv?from=${from}&to=${to}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...visitorHeaders(await visitorIp(), INTERNAL_API_SECRET),
      },
      cache: "no-store",
    });
  } catch {
    return back(exportProblemFor(null)); // no answer at all (asleep, restarting, offline)
  }
  if (upstream.status === 401) {
    return NextResponse.redirect(new URL("/sign-in", request.url), 303);
  }
  if (!upstream.ok) {
    await upstream.body?.cancel().catch(() => undefined);
    return back(exportProblemFor(upstream.status));
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition":
        upstream.headers.get("content-disposition") ??
        `attachment; filename="outings-${from}-to-${to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
