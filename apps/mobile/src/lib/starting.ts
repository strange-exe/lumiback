/**
 * What the starting screen says while the launch check waits for the server. On the free
 * hosting plan the server sleeps when nobody uses it and takes up to about a minute to wake,
 * so after a few seconds the screen says why it is taking long. Pure, so the wording is tested.
 */

/** How long a normal start takes before the screen explains a slow one. */
export const SLOW_AFTER_MS = 5_000;

export function startingLines(elapsedMs: number): { title: string; detail: string | null } {
  if (elapsedMs < SLOW_AFTER_MS) return { title: "Starting Lumiback", detail: null };
  return {
    title: "Starting Lumiback",
    detail: "The server is waking up after a quiet spell. This can take up to a minute.",
  };
}
