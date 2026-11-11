import { ApiError, callBackend } from "@/lib/backend";
import { isSameOrigin, isUuid, plainError } from "@/lib/route";
import { accessToken } from "@/lib/session";

/**
 * POST (navigator.sendBeacon from `beforeunload`): the share tab is closing. The backend ends
 * the share a short grace later unless the tab says it stayed (DELETE, sent when the student
 * cancels "Leave site?"). The stop beacon on `pagehide` ends it at once, but a slow device can
 * be torn down before that handler runs; the browser waits for `beforeunload`.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/share/[id]/leaving">,
): Promise<Response> {
  return forward(request, ctx, "POST");
}

/** The tab is still open after saying it was leaving. */
export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/share/[id]/leaving">,
): Promise<Response> {
  return forward(request, ctx, "DELETE");
}

async function forward(
  request: Request,
  ctx: RouteContext<"/api/share/[id]/leaving">,
  method: "POST" | "DELETE",
): Promise<Response> {
  if (!isSameOrigin(request)) {
    refused(method, "not same-origin (403)");
    return plainError(403, "Forbidden");
  }
  const { id } = await ctx.params;
  if (!isUuid(id)) return plainError(404, "Not found");
  const token = await accessToken();
  if (!token) {
    refused(method, "no access token (401)");
    return plainError(401, "Not signed in");
  }
  try {
    await callBackend(`/sessions/${id}/leaving`, { method, token });
  } catch (error: unknown) {
    const status = error instanceof ApiError ? error.status : 502;
    refused(method, `backend said ${error instanceof ApiError ? status : "nothing (unreachable)"}`);
    // The tab retries a DELETE that failed for a reason worth retrying (5xx, unreachable).
    return new Response(null, { status });
  }
  return new Response(null, { status: 204 });
}

/** One server-log line when a leave or a stay was not applied. No ids or tokens. */
function refused(method: "POST" | "DELETE", why: string): void {
  console.warn(`tab ${method === "POST" ? "leaving" : "stayed"} not applied: ${why}`);
}
