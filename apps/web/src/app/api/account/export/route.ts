import { streamBackend } from "@/lib/backend";
import { errorResponse, isSameOrigin, plainError } from "@/lib/route";
import { accessToken } from "@/lib/session";

/**
 * "Download my data": the signed-in person's records as a JSON file. The backend's body is
 * passed straight through (never parsed or kept here). Same-origin only: another site can't
 * spend the hourly export limit by pointing a link here.
 */
export async function GET(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return plainError(403, "Not allowed");
  const token = await accessToken();
  if (!token) return plainError(401, "Not signed in");
  try {
    const upstream = await streamBackend("/profile/export", { token });
    const day = new Date().toISOString().slice(0, 10);
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="lumiback-data-${day}.json"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
