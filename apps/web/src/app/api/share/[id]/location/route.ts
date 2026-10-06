import { callBackend } from "@/lib/backend";
import { errorResponse, isSameOrigin, isUuid, plainError } from "@/lib/route";
import { accessToken } from "@/lib/session";

interface Fix {
  lat: number;
  lng: number;
  accuracy_m: number;
  recorded_at: string;
}

function parseFix(body: unknown): Fix | null {
  if (!body || typeof body !== "object") return null;
  const { lat, lng, accuracy_m, recorded_at } = body as Record<string, unknown>;
  const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  if (!finite(lat) || !finite(lng) || !finite(accuracy_m) || typeof recorded_at !== "string") {
    return null;
  }
  return { lat, lng, accuracy_m, recorded_at }; // only these fields reach the backend
}

/** The sharer's tab reports its position. Only the latest is kept, server-side. */
export async function PUT(
  request: Request,
  ctx: RouteContext<"/api/share/[id]/location">,
): Promise<Response> {
  if (!isSameOrigin(request)) return plainError(403, "Forbidden");
  const { id } = await ctx.params;
  if (!isUuid(id)) return plainError(404, "Not found");
  const token = await accessToken();
  if (!token) return plainError(401, "Not signed in");
  const fix = parseFix(await request.json().catch(() => null));
  if (!fix) return plainError(422, "Invalid location");
  try {
    await callBackend(`/sessions/${id}/location`, { method: "PUT", token, body: fix });
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
