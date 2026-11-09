import entries from "./changelog.json";

/**
 * What's new in each release, newest first; the newest entry is Lumiback's version. A copy of
 * the app's list (apps/mobile/src/updates/changelog.json); changelog.test.ts checks they match.
 */
export interface Release {
  version: string;
  /** YYYY-MM-DD */
  date: string;
  title: string;
  /** One line (at most 140 characters) for the update announcement push. */
  summary?: string;
  /**
   * What the announcement for it is: "feature" | "fix" | "maintenance" | "notice"
   * (changelog.test.ts checks). Typed as a string because JSON imports widen it.
   */
  kind?: string;
  points: string[];
}

export const CHANGELOG: readonly Release[] = entries;
export const CURRENT: Release = CHANGELOG[0]!;
