import { ApiError } from "@/lib/api";

/**
 * Following someone's share from a link or the Follow view. Free of React so it can be tested.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every share id the server hands out is a UUID. Anything else from a link is refused before it
 * reaches a backend path, where "../" could point the student's token at another endpoint (the
 * web app does the same, apps/web/src/lib/ids.ts).
 */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

const WAITING = "Waiting for the sharer to approve you"; // backend AWAITING_APPROVAL detail
export const NOT_A_SHARE =
  "This link doesn't open a live share. Check it with the person who sent it.";

export type FollowFailure =
  | { kind: "pending" }
  | { kind: "ended"; reason: string }
  | { kind: "failed"; reason: string }
  | { kind: "offline" };

/**
 * What a failed poll of a followed share means. Only "can't reach" (no connection, a 5xx, rate
 * limited) is worth retrying; any other answer from the server will not change by itself.
 */
export function followFailure(error: unknown): FollowFailure {
  if (!(error instanceof ApiError)) return { kind: "offline" };
  if (error.status === 403 && error.detail === WAITING) return { kind: "pending" };
  if (error.status === 403) return { kind: "ended", reason: error.detail };
  if (error.status === 404 || error.status === 409) {
    return { kind: "ended", reason: "This live share has ended." };
  }
  if (error.status === 0 || error.status === 429 || error.status >= 500) return { kind: "offline" };
  return { kind: "failed", reason: NOT_A_SHARE };
}
