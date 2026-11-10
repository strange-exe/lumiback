import { ApiError, callBackend } from "@/lib/backend";
import { isSameOrigin, isUuid, plainError } from "@/lib/route";
import { accessToken } from "@/lib/session";

/**
 * Called with navigator.sendBeacon when the share tab closes: the browser delivers it even as
 * the page goes away, which a normal fetch or Server Action cannot promise. If it never
 * arrives (crash, dead battery), the backend ends the share once the tab stops checking in.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/share/[id]/stop">,
): Promise<Response> {
  if (!isSameOrigin(request)) {
    refused("not same-origin (403)");
    return plainError(403, "Forbidden");
  }
  const { id } = await ctx.params;
  if (!isUuid(id)) return plainError(404, "Not found");
  const token = await accessToken();
  if (!token) {
    refused("no access token (401)");
    return plainError(401, "Not signed in");
  }
  // Nobody is left to read an error, and the idle sweep is the fallback, but a share that keeps
  // running after its tab closed is worth a line in the server log.
  await callBackend(`/sessions/${id}/stop`, {
    method: "POST",
    token,
    body: { reason: "tab_closed" },
  }).catch((error: unknown) => {
    refused(`backend said ${error instanceof ApiError ? error.status : "nothing (unreachable)"}`);
  });
  return new Response(null, { status: 204 });
}

/** One server-log line when a tab-close stop did not end a share. No ids or tokens. */
function refused(why: string): void {
  console.warn(`tab-close stop not applied: ${why}`);
}
