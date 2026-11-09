import { NextResponse, type NextRequest } from "next/server";

import { istToday } from "@/features/admin/format";
import {
  reportBackPath,
  reportProblemFor,
  resolveReportRange,
  type ReportProblem,
} from "@/features/admin/reports";
import { visitorIp } from "@/lib/backend";
import { visitorHeaders } from "@/lib/client-ip";
import { BACKEND_URL, INTERNAL_API_SECRET } from "@/lib/config";
import { accessToken } from "@/lib/session";

/**
 * The Reports page as CSV for a date range. A GET that changes nothing, so a plain link can
 * point here; the backend checks the role, scopes the hostels and checks the range again. When
 * there is no file to give, the visitor goes back to the Reports page with the reason shown at
 * the download (never a bare text page or a framework error).
 */
export async function GET(request: NextRequest): Promise<Response> {
  const token = await accessToken();
  if (!token) return NextResponse.redirect(new URL("/sign-in", request.url), 303);
  const from = request.nextUrl.searchParams.get("from") ?? "";
  const to = request.nextUrl.searchParams.get("to") ?? "";
  const back = (problem: ReportProblem) =>
    NextResponse.redirect(new URL(reportBackPath(problem, from, to), request.url), 303);

  // Both dates are needed here: an empty pair would mean "the last 30 days" on the page, but a
  // download names its range.
  if (!from || !to) return back("dates");
  const range = resolveReportRange(from, to, istToday());
  if (range.problem) return back(range.problem);

  let upstream: Response;
  try {
    const query = new URLSearchParams({ from: range.from, to: range.to });
    upstream = await fetch(`${BACKEND_URL}/admin/reports.csv?${query.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...visitorHeaders(await visitorIp(), INTERNAL_API_SECRET),
      },
      cache: "no-store",
    });
  } catch {
    return back(reportProblemFor(null)); // no answer at all (asleep, restarting, offline)
  }
  if (upstream.status === 401) {
    return NextResponse.redirect(new URL("/sign-in", request.url), 303);
  }
  if (!upstream.ok) {
    await upstream.body?.cancel().catch(() => undefined);
    return back(reportProblemFor(upstream.status));
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition":
        upstream.headers.get("content-disposition") ??
        `attachment; filename="report-${range.from}-to-${range.to}.csv"`,
      "Cache-Control": "private, no-store", // as the API sends it: the office's records
    },
  });
}
