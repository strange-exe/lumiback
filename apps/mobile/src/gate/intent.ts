/**
 * "Let my emergency contact follow until I'm back", carried from Today to the scan screen.
 *
 * Only Today's visible, ticked box may turn safe return on: it starts location sharing and the
 * server emails the emergency contact. So the tick never travels as a plain route parameter
 * (lumiback://scan?safe=1 could be opened by any link or app). Today arms an in-memory intent
 * and passes only its random id; the scan screen honours it if that id is the one armed here,
 * within a short time, and consumes it so it works once. A link can't know the id, and a link
 * that opens the scanner later finds nothing armed.
 *
 * Pure (no Expo imports) so it is unit-tested.
 */

/** Long enough for the scan screen to open; the intent is read when that screen mounts. */
export const INTENT_TTL_MS = 2 * 60_000;

let pending: { id: string; at: number } | null = null;

/**
 * Not a secret against anyone with access to this app's memory, only unguessable for a link
 * that has to be written in advance: random enough for that, with no native crypto module.
 */
function newId(now: number): string {
  return `${now.toString(36)}${Math.random().toString(36).slice(2, 12)}${Math.random()
    .toString(36)
    .slice(2, 12)}`;
}

/** Today: the box is ticked and Scan is about to open. Returns the id to pass to Scan. */
export function armSafeReturn(now = Date.now()): string {
  const id = newId(now);
  pending = { id, at: now };
  return id;
}

function armed(id: unknown, now: number): boolean {
  return (
    typeof id === "string" &&
    id.length > 0 &&
    pending !== null &&
    pending.id === id &&
    now >= pending.at &&
    now - pending.at <= INTENT_TTL_MS
  );
}

/**
 * Whether a scan screen opened with these route params should ask for safe return. Reads only
 * the `intent` id; any other parameter (an old `safe=1` link included) is ignored. No side effect,
 * so it is safe to call while rendering; consume the intent once the screen has mounted.
 */
export function safeReturnFor(
  params: Record<string, string | string[] | undefined>,
  now = Date.now(),
): boolean {
  return armed(params.intent, now);
}

/** Use the intent up: true once for the armed id (if still fresh), then false. */
export function consumeSafeReturn(id: unknown, now = Date.now()): boolean {
  const ok = armed(id, now);
  if (ok || (pending !== null && now - pending.at > INTENT_TTL_MS)) pending = null;
  return ok;
}

/** Forget any armed intent (tests; also safe to call on sign-out). */
export function clearSafeReturn(): void {
  pending = null;
}
