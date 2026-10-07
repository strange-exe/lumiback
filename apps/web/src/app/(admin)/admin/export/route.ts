import { NextResponse, type NextRequest } from "next/server";

import { visitorIp } from "@/lib/backend";
import { visitorHeaders } from "@/lib/client-ip";
import { BACKEND_URL, INTERNAL_API_SECRET } from "@/lib/config";
import { accessToken } from "@/lib/session";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The register as CSV for a date range. A GET that changes nothing, so a plain form can point
 * here; the backend still checks the admin role and the range.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const token = await accessToken();
  if (!token) return NextResponse.redirect(new URL("/sign-in", request.url));
  const from = request.nextUrl.searchParams.get("from") ?? "";
  const to = request.nextUrl.searchParams.get("to") ?? "";
  if (!DATE.test(from) || !DATE.test(to)) {
    return new Response("Choose a start and end date.", { status: 422 });
  }

  const upstream = await fetch(`${BACKEND_URL}/admin/outings.csv?from=${from}&to=${to}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...visitorHeaders(await visitorIp(), INTERNAL_API_SECRET),
    },
    cache: "no-store",
  });
  if (!upstream.ok) {
    const payload = (await upstream.json().catch(() => null)) as { detail?: unknown } | null;
    const detail = typeof payload?.detail === "string" ? payload.detail : "Download failed.";
    return new Response(detail, {
      status: upstream.status === 401 || upstream.status === 403 ? 404 : upstream.status,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
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
