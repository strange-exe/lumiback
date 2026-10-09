/**
 * Which release, native build and over-the-air update this copy of the app is running.
 * Shown under Profile so "is my phone up to date?" can be answered from a screenshot.
 */

export interface BuildFacts {
  /** The newest changelog entry this code ships with ("1.3.0"). */
  version: string;
  /** Its date, YYYY-MM-DD. */
  date: string;
  runtimeVersion: string | null;
  updateId: string | null;
  isEmbeddedLaunch: boolean;
  /** Installed app builds by runtime version (see changelog.ts). */
  builds: Readonly<Record<string, number>>;
}

const short = (id: string) => id.replace(/-/g, "").slice(0, 8);

/** ["Version 1.3.0 · 9 Oct 2026", "App build 1 · update 01a11f55"] */
export function buildLines(facts: BuildFacts, formatDay: (iso: string) => string): string[] {
  const head = `Version ${facts.version} · ${formatDay(facts.date)}`;
  if (!facts.runtimeVersion) return [head]; // development build: nothing more to show
  const n = facts.builds[facts.runtimeVersion];
  const build = n ? `App build ${n}` : `App build ${short(facts.runtimeVersion)}`;
  const update =
    facts.isEmbeddedLaunch || !facts.updateId ? "built-in code" : `update ${short(facts.updateId)}`;
  return [head, `${build} · ${update}`];
}
