import entries from "./changelog.json";

/**
 * What's new in each release, newest first. The newest entry IS the app's version: every
 * over-the-air update that changes something adds an entry here, so the version shown and
 * the notes can't drift apart. The website keeps a copy (apps/web/src/lib/changelog.json; a
 * web test checks they match).
 *
 * Versions: patch (1.3.1) = fixes, minor (1.4.0) = features, major (2.0.0) = big changes.
 * The number says nothing about reinstalling: see NATIVE_BUILDS.
 */
export interface Release {
  version: string;
  /** YYYY-MM-DD */
  date: string;
  title: string;
  points: string[];
}

export const CHANGELOG: readonly Release[] = entries;
export const CURRENT: Release = CHANGELOG[0]!;

/**
 * Installed app builds (the native part, which only a new APK or store update changes), by
 * runtime version. Add the next build's runtime here when it is made; an unknown runtime is
 * shown by its short code instead.
 */
export const NATIVE_BUILDS: Readonly<Record<string, number>> = {
  c22cefa5baa82b88409c594c5d53df19ed6c2fe1: 1,
};

/**
 * Show "What's new" once, after an update brings a newer release than the one last shown.
 * `seen` null: never recorded. On a fresh install (the APK's built-in code) there's nothing
 * "new" to announce; on phones updated from before this existed, there is.
 */
export function shouldShowWhatsNew({
  seen,
  current,
  isEmbeddedLaunch,
}: {
  seen: string | null;
  current: string;
  isEmbeddedLaunch: boolean;
}): boolean {
  if (seen === null) return !isEmbeddedLaunch;
  return compareVersions(current, seen) > 0;
}

/** -1, 0 or 1, comparing "1.3.0"-style versions. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}
