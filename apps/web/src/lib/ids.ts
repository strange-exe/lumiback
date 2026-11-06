/**
 * Ids that go into backend paths. Every record id the backend hands out is a UUID; anything
 * else from a form or URL is refused before it reaches a path (where "../" could point the
 * caller's token at a different endpoint). Free of server code so it can be unit tested.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MISSING_ITEM = "That item couldn't be found. Reload the page and try again.";

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
