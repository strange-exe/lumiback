import { cookies } from "next/headers";

import type { WatchEvent } from "@/features/watch/events";
import { callBackend } from "@/lib/backend";
import { BACKEND_URL } from "@/lib/config";
import { guestCookie } from "@/lib/cookies";
import { isUuid } from "@/lib/route";
import { accessToken } from "@/lib/session";
import type { LiveLocation, Watching } from "@/lib/types";

const BACKEND_WS = `${BACKEND_URL.replace(/^http/, "ws")}/ws`;
const KEEPALIVE_MS = 25_000; // under common proxy idle timeouts (Caddy, nginx: 60 s+)
const CLOSE_UNAUTHENTICATED = 4401;

interface BackendMessage {
  type?: string;
  location?: LiveLocation | null;
  mocked_location?: LiveLocation | null;
  reason?: string;
}

const positions = (data: BackendMessage): Extract<WatchEvent, { type: "live" }> => ({
  type: "live",
  location: data.location ?? null,
  mocked_location: data.mocked_location ?? null,
});

const encoder = new TextEncoder();
const frame = (event: WatchEvent): Uint8Array =>
  encoder.encode(`data: ${JSON.stringify(event)}\n\n`);

/**
 * Live location for the watch page as Server-Sent Events.
 *
 * The browser talks only to this same-origin endpoint with its httpOnly cookies; this handler
 * holds the backend WebSocket on the server. Tokens never reach page scripts and the API needs
 * no public WebSocket endpoint. When the access token expires, the backend closes the socket;
 * we end the stream and the browser's EventSource reconnects on its own, passing through
 * proxy.ts, which refreshes the cookie first.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/watch/[id]/stream">,
): Promise<Response> {
  const { id } = await ctx.params;
  const guest = isUuid(id) ? ((await cookies()).get(guestCookie(id))?.value ?? null) : null;
  const token = guest ? null : await accessToken();

  let finish = (): void => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      let socket: WebSocket | null = null;
      // The browser can go away at any moment (cancel/abort); after that the controller
      // throws on enqueue and close, so every write goes through these guarded helpers.
      const write = (chunk: Uint8Array): void => {
        if (!open) return;
        try {
          controller.enqueue(chunk);
        } catch {
          finish();
        }
      };
      const send = (event: WatchEvent): void => write(frame(event));
      const keepalive = setInterval(() => write(encoder.encode(": keepalive\n\n")), KEEPALIVE_MS);
      finish = () => {
        if (!open) return;
        open = false;
        clearInterval(keepalive);
        socket?.close();
        try {
          controller.close();
        } catch {
          // Already cancelled by the browser: nothing left to close.
        }
      };
      request.signal.addEventListener("abort", finish);
      write(encoder.encode("retry: 2000\n\n"));

      if (!isUuid(id) || (!guest && !token)) {
        send({ type: "gone" });
        finish();
        return;
      }

      let described = false;
      const describe = async (): Promise<Watching | undefined> => {
        if (described) return undefined;
        described = true;
        // The sharer opening their own share gets the owner's view, which has no `sharer`.
        return callBackend<Partial<Watching>>(`/sessions/${id}`, { token, guestToken: guest })
          .then((s) => (s.sharer ? (s as Watching) : undefined))
          .catch(() => undefined);
      };

      socket = new WebSocket(BACKEND_WS);
      socket.onopen = () => {
        socket?.send(
          JSON.stringify(guest ? { type: "auth", guest_token: guest } : { type: "auth", token }),
        );
      };
      socket.onmessage = async (message) => {
        let data: BackendMessage;
        try {
          data = JSON.parse(String(message.data));
        } catch {
          return finish();
        }
        switch (data.type) {
          case "ready":
            socket?.send(JSON.stringify({ type: "subscribe", session_id: id }));
            break;
          case "pending":
            send({ type: "pending" });
            break;
          case "subscribed":
          case "granted":
            send({ ...positions(data), share: await describe() });
            break;
          case "location":
            send(positions(data));
            break;
          case "ended":
            send({ type: "ended", reason: data.reason ?? "ended" });
            finish();
            break;
          case "reauth_required":
            finish(); // let the browser reconnect with a refreshed cookie
            break;
          case "error":
            send({ type: "gone" });
            finish();
            break;
        }
      };
      socket.onclose = (event) => {
        // A guest pass never expires mid-stream, so 4401 for a guest means it is not valid.
        if (event.code === CLOSE_UNAUTHENTICATED && guest) send({ type: "gone" });
        finish();
      };
      socket.onerror = () => finish(); // backend unreachable: the browser retries
    },
    cancel() {
      finish();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
