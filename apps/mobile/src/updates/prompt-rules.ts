/** When the update prompt asks the server, and when it shows. Plain functions, so they're tested
 * without expo-updates. */

/** Foreground checks at most this often (Expo advises against polling in a loop). */
export const CHECK_EVERY_MS = 5 * 60_000;
/** "Remind me later" hides the prompt for this long (or until the next launch). */
export const SNOOZE_MS = 4 * 60 * 60_000;

/** "Remind me later" for one update (id null: the server didn't say which). */
export interface Snooze {
  id: string | null;
  at: number;
}

export function shouldCheck(lastCheck: number | null, now: number): boolean {
  return lastCheck === null || now - lastCheck >= CHECK_EVERY_MS;
}

/**
 * May the prompt show on the current screen? Never over the gate scanner (the student is mid-scan),
 * and only once signed in, except a required build: without it signing in can't work.
 */
export function promptAllowed({
  signedIn,
  pathname,
  required = false,
}: {
  signedIn: boolean;
  pathname: string;
  required?: boolean;
}): boolean {
  if (pathname === "/scan") return false;
  return signedIn || required;
}

export function shouldPrompt({
  available,
  id,
  snooze,
  now,
}: {
  available: boolean;
  id: string | null;
  snooze: Snooze | null;
  now: number;
}): boolean {
  if (!available) return false;
  // A newer update than the one put off asks again straight away.
  if (snooze && snooze.id === id && now - snooze.at < SNOOZE_MS) return false;
  return true;
}
