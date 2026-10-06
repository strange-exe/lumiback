import { callBackend } from "@/lib/backend";
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
  if (!isSameOrigin(request)) return plainError(403, "Forbidden");
  const { id } = await ctx.params;
  if (!isUuid(id)) return plainError(404, "Not found");
  const token = await accessToken();
  if (!token) return plainError(401, "Not signed in");
  await callBackend(`/sessions/${id}/stop`, {
    method: "POST",
    token,
    body: { reason: "tab_closed" },
  }).catch(() => undefined); // nobody is left to read an error; the idle sweep is the fallback
  return new Response(null, { status: 204 });
}
