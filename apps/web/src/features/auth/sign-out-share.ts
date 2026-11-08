/**
 * Signing out of the browser you share from ends that tab's live share: nobody is left to stop
 * it. Not a safe-return share (source "outing"): it belongs to the outing and ends when the
 * student is back. Both calls are made as the signed-in person themselves, so a developer who
 * is viewing as another role (where the API refuses every change) still stops their own share.
 * Best effort: a failure never blocks the sign-out. Pure (no Next.js imports) for `node --test`.
 */

export type SelfCall = (
  path: string,
  options: { method?: "POST"; token: string; asSelf: true },
) => Promise<unknown>;

interface ShareLike {
  id: string;
  source: string;
  status: string;
}

/** Stops this account's running tab share; returns its id, or null when none was stopped. */
export async function endTabShare(access: string, call: SelfCall): Promise<string | null> {
  const lookup = call("/sessions/mine", { token: access, asSelf: true });
  const mine = (await lookup.catch(() => null)) as ShareLike[] | null;
  const live = mine?.find((s) => s.status === "active" && s.source === "tab_live");
  if (!live) return null;
  const path = `/sessions/${encodeURIComponent(live.id)}/stop`;
  const stopped = await call(path, { method: "POST", token: access, asSelf: true }).then(
    () => true,
    () => false,
  );
  return stopped ? live.id : null;
}
