import type { LiveLocation, Watching } from "@/lib/types";

/**
 * What the watch page receives over its event stream. The route handler translates the
 * backend's WebSocket protocol into these, so the page never sees backend details.
 *   pending  joined with a code; the sharer has not approved yet
 *   live     approved: the latest real location (null until the sharer's first fix), the latest
 *            mock-location fix if any (see lib/mock.ts) and, once, who
 *   ended    the share stopped, ran out, closed, or this viewer was removed (terminal)
 *   gone     no access at all: unknown share, not signed in, or a bad guest pass (terminal)
 */
export type WatchEvent =
  | { type: "pending" }
  | {
      type: "live";
      location: LiveLocation | null;
      mocked_location: LiveLocation | null;
      share?: Watching;
    }
  | { type: "ended"; reason: string }
  | { type: "gone" };

export const TERMINAL: ReadonlySet<WatchEvent["type"]> = new Set(["ended", "gone"]);
