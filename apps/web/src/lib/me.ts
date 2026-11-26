/**
 * Who /auth/me says is signed in, for lib/session.ts. Pure (no Next.js imports), so
 * `node --test` can load it; session.ts supplies the API call and the per-request memo.
 */
import { ApiError } from "./api-error.ts";
import type { User, ViewRole } from "./types.ts";
import { endsViewAs, viewingAsOf } from "./view-as.ts";

/** GET /auth/me with the signed-in token; `asSelf` leaves out the view-as header. */
export type AskMe = (asSelf: boolean) => Promise<User>;

/**
 * `user`: while a developer views as a role, `role` is that role and `viewing_as` equals it.
 * `stale`: this browser's view is no good (the API ignored or refused it), so the user is the
 * real one and the view-as cookie must be cleared.
 */
export interface Found {
  user: User;
  stale: boolean;
}

/**
 * Ask /auth/me, with the view-as role this browser's cookie names (or null). Null means signed
 * out (401, 403, or a refused view whose second ask failed too); anything else unexpected throws.
 */
export async function whoIsSignedIn(ask: AskMe, viewing: ViewRole | null): Promise<Found | null> {
  try {
    const user = await ask(false);
    return { user, stale: viewing !== null && viewingAsOf(user) !== viewing };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    if (viewing && endsViewAs(error.status, error.detail)) {
      // Ask again as the person themselves (no header), so they stay signed in.
      const self = await ask(true).catch(() => null);
      return self ? { user: { ...self, viewing_as: null }, stale: true } : null;
    }
    if (error.status === 401 || error.status === 403) return null;
    throw error;
  }
}
