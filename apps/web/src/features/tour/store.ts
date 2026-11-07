/**
 * The tour's small pieces of browser state: the last version it was shown for (localStorage,
 * one key per account), and "Take the tour again" requests. Free of React and Next imports, so
 * `node --test` can load it; every storage access survives a browser that blocks storage.
 */

/** The parts of Storage the tour uses (a fake one in tests). */
export interface TourStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function seenKey(userId: string): string {
  return `lb-tour-seen:${userId}`;
}

/** The browser's localStorage, or null when reading it throws (blocked, private mode). */
export function browserStorage(): TourStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The version the last tour was shown for. Null: never shown. Storage that can't be read
 * counts as "already seen", so a browser without storage isn't shown the tour on every page.
 */
export function readSeen(
  storage: TourStorage | null,
  userId: string,
  current: string,
): string | null {
  if (!storage) return current;
  try {
    const value = storage.getItem(seenKey(userId));
    return value && /^\d+\.\d+\.\d+$/.test(value) ? value : null;
  } catch {
    return current;
  }
}

export function writeSeen(storage: TourStorage | null, userId: string, version: string): void {
  try {
    storage?.setItem(seenKey(userId), version);
  } catch {
    // Full or blocked: the tour still closes; it may show again next time.
  }
}

/**
 * Automated browsers (navigator.webdriver: Playwright, Selenium) don't get the tour on their
 * own, so end-to-end tests of other pages never meet an overlay they didn't ask for. A test of
 * the tour opts in with this storage key (e2e/tour.spec.ts).
 */
export const AUTOMATION_OPT_IN = "lb-tour-under-test";

export function tourAllowed(storage: TourStorage | null, webdriver: boolean): boolean {
  if (!webdriver) return true;
  try {
    return storage?.getItem(AUTOMATION_OPT_IN) === "1";
  } catch {
    return false;
  }
}

// ---------- "Take the tour again" ----------

/**
 * A replay asked for, waiting for a tour to run it. It's kept until a tour takes it, because
 * the button can be on a page whose layout has no tour (a warden's Account page asks for the
 * hostel office's tour, which mounts after navigating there).
 */
let pending = false;
const listeners = new Set<() => void>();

export function requestReplay(): void {
  pending = true;
  listeners.forEach((listener) => listener());
}

/** Takes the waiting replay, if any (only one tour gets it). */
export function takeReplay(): boolean {
  const had = pending;
  pending = false;
  return had;
}

export function onReplay(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
