/**
 * Acting on several people at once from the People list: which ids a submit may carry, and how
 * the per-person calls run. There is no bulk endpoint on purpose: each person goes through the
 * same API call as their own row's button, so the backend applies exactly today's rules (who
 * may change whom, a developer's account, the last admin, someone who is out) and its refusal
 * is reported for that person. Pure (no Next.js imports), so `node --test` can load it.
 */

import { ApiError, VIEW_AS_READ_ONLY } from "../../lib/api-error.ts";
import { isUuid } from "../../lib/ids.ts";
import { READ_ONLY } from "../../lib/view-as.ts";

/** Most people one submit acts on (each is its own API call, one after another). */
export const BULK_MAX = 100;

/**
 * Set-up links: the API sends an admin at most 30 an hour (PASSWORD_LINKS in api/admin.py);
 * past that each person says "Not tried", and the bar warns before the submit.
 */
export const BULK_LINK_MAX = 30;

export type BulkOp = "move" | "link" | "off";

export function bulkOp(value: unknown): BulkOp | null {
  return value === "move" || value === "link" || value === "off" ? value : null;
}

/** The ticked ids: every one a UUID, duplicates dropped, at most BULK_MAX. */
export function bulkIds(values: readonly unknown[]): { ids: string[] } | { error: string } {
  const ids: string[] = [];
  for (const value of values) {
    if (!isUuid(value)) {
      return { error: "Someone in the list couldn't be found. Reload the page and try again." };
    }
    const lower = value.toLowerCase();
    if (!ids.includes(lower)) ids.push(lower);
  }
  if (ids.length === 0) return { error: "Tick at least one person first." };
  if (ids.length > BULK_MAX) {
    return { error: `Choose at most ${BULK_MAX} people at a time. Nothing was changed.` };
  }
  return { ids };
}

/** What happened for one person. `name` comes from the API's answer (null when refused). */
export interface BulkOutcome {
  id: string;
  name: string | null;
  done: boolean;
  message: string;
}

/**
 * A refusal that would repeat for everyone after it: viewing as a role (read-only), a rate
 * limit, or the server not answering. The rest are then not tried, and say why.
 */
function stopsTheRest(error: ApiError): boolean {
  if (error.status === 403 && (error.detail === VIEW_AS_READ_ONLY || error.detail === READ_ONLY)) {
    return true;
  }
  return error.status === 429 || error.status >= 500;
}

/**
 * Calls `act` for each id in turn. A refusal (ApiError) is recorded for that person and the
 * next one is tried, unless it would repeat for all of them. A 401 (signed out) and anything
 * that isn't an ApiError are thrown: the caller sends a 401 to sign-in, and a bug isn't hidden.
 */
export async function runEach(
  ids: readonly string[],
  act: (id: string) => Promise<{ name: string | null; message: string }>,
): Promise<BulkOutcome[]> {
  const outcomes: BulkOutcome[] = [];
  for (const [index, id] of ids.entries()) {
    try {
      const { name, message } = await act(id);
      outcomes.push({ id, name, done: true, message });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status === 401) throw error;
      outcomes.push({ id, name: null, done: false, message: error.detail });
      if (stopsTheRest(error)) {
        for (const rest of ids.slice(index + 1)) {
          outcomes.push({
            id: rest,
            name: null,
            done: false,
            message: `Not tried: ${error.detail}`,
          });
        }
        break;
      }
    }
  }
  return outcomes;
}

const DONE: Record<BulkOp, (n: number) => string> = {
  move: () => "moved",
  link: (n) => (n === 1 ? "link sent" : "links sent"),
  off: () => "turned off",
};

/** "2 turned off, 1 not." */
export function bulkSummary(op: BulkOp, outcomes: readonly BulkOutcome[]): string {
  const done = outcomes.filter((o) => o.done).length;
  const not = outcomes.length - done;
  return `${done} ${DONE[op](done)}${not > 0 ? `, ${not} not` : ""}.`;
}
