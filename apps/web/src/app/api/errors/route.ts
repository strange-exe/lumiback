import { callBackend, visitorIp } from "@/lib/backend";
import { CURRENT } from "@/lib/changelog";
import { isSameOrigin, plainError } from "@/lib/route";
import { accessToken } from "@/lib/session";

/** The API's own cap (backend app/api/errors.py MAX_BODY_BYTES). */
const MAX_BODY_BYTES = 16 * 1024;

/** The body as text, or null once it passes the cap (read in pieces, never all at once). */
async function cappedText(request: Request): Promise<string | null> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(length) || length > MAX_BODY_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * Where the website's error reporter (lib/report-error.ts) sends what broke. Passed on to the
 * API's POST /errors with the visitor's session (if any) and real IP, so the API's per-IP and
 * per-user limits apply; the API checks every field and scrubs it before storing anything.
 * Once checked here, the answer is always 204: a report about a failed report would loop, and
 * the reporter sends at most a few per page anyway.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return plainError(403, "Forbidden");
  const type = request.headers.get("content-type") ?? "";
  if (!type.startsWith("application/json")) return plainError(422, "Send JSON");
  const text = await cappedText(request);
  if (text === null) return plainError(422, "Too long");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return plainError(422, "Send JSON");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return plainError(422, "Send JSON");
  }
  await callBackend("/errors", {
    method: "POST",
    // This route is the website's: its platform, and the version of the build serving it.
    body: { ...body, platform: "web", app_version: CURRENT.version },
    token: await accessToken(),
    clientIp: await visitorIp(),
  }).catch(() => undefined); // asleep, rate limited or refused: nobody is left to tell
  return new Response(null, { status: 204 });
}
