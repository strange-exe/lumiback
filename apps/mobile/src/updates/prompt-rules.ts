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

/**
 * What the over-the-air sheet shows while it updates: a bar with the download's progress
 * (useUpdates().downloadProgress, 0..1), then "Restarting…" once the update is on the phone.
 * `percent` null: the bar shows an indeterminate sliver until the first progress arrives.
 */
export function overTheAirProgress({
  updating,
  pending,
  downloading,
  progress,
}: {
  updating: boolean;
  pending: boolean;
  downloading: boolean;
  progress: number | undefined;
}): { bar: boolean; percent: number | null; label: string } {
  if (!updating) return { bar: false, percent: null, label: "Updating…" };
  if (pending) return { bar: false, percent: null, label: "Restarting…" };
  const known = downloading && typeof progress === "number" && Number.isFinite(progress);
  const percent = known ? Math.round(Math.min(1, Math.max(0, progress)) * 100) : null;
  return {
    bar: true,
    percent,
    label: percent === null ? "Downloading…" : `Downloading… ${percent}%`,
  };
}

/**
 * After an "app updated" notification is tapped: "update" when the server has a newer update
 * for this build (download it and restart, even if "Remind me later" was chosen: the tap asked
 * for it), otherwise "notes" (show What's new; nothing restarts). Development builds and builds
 * without updates never check: expo-updates rejects there.
 */
export function announcedUpdateStep({
  enabled,
  dev,
  check,
}: {
  enabled: boolean;
  dev: boolean;
  /** checkForUpdateAsync's answer; null when it failed or didn't run. */
  check: { isAvailable: boolean } | null;
}): "update" | "notes" {
  if (!enabled || dev) return "notes";
  return check?.isAvailable ? "update" : "notes";
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
