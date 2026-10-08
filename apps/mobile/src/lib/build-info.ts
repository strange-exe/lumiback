/**
 * Which native build and which over-the-air update this copy of the app is running.
 * Shown under Profile so "is my phone up to date?" can be answered from a screenshot.
 */

export interface BuildFacts {
  version: string | null | undefined;
  runtimeVersion: string | null;
  updateId: string | null;
  createdAt: Date | null;
  isEmbeddedLaunch: boolean;
}

const short = (id: string) => id.replace(/-/g, "").slice(0, 8);

/** ["Lumiback 0.1.0", "Build c22cefa5 · Update 01a11bae, 8 Oct"] */
export function buildLines(facts: BuildFacts, formatDay: (d: Date) => string): string[] {
  const head = ["Lumiback", facts.version].filter(Boolean).join(" ");
  if (!facts.runtimeVersion) return [head]; // development build: nothing useful to show
  const build = `Build ${short(facts.runtimeVersion)}`;
  const update =
    facts.isEmbeddedLaunch || !facts.updateId
      ? "No updates yet"
      : `Update ${short(facts.updateId)}${facts.createdAt ? `, ${formatDay(facts.createdAt)}` : ""}`;
  return [head, `${build} · ${update}`];
}
