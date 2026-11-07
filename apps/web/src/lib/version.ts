/**
 * Release versions ("1.14.0"), as in changelog.json. Pure, so `node --test` can load it.
 * Negative when a is older than b, 0 when equal, positive when a is newer.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}
