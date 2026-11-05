/**
 * Who a watch page speaks as: the signed-in user, or a guest pass (a code-joined guest's token,
 * or a safe-return link's key). Pure (no Next.js imports) so it runs under `node --test`; the
 * server action and the stream route pass in the real backend probe and cookie store.
 */

/** What one credential may do on one share, from GET /sessions/{id}. */
export type Access =
  | "granted" // the sharer, or an approved viewer
  | "restricted" // a viewer waiting for approval, or whose access ended
  | "none" // no relation to this share (or not a valid credential)
  | "unknown"; // the backend couldn't answer (offline, rate limit, server error)

export type Credential = { kind: "user"; token: string } | { kind: "guest"; token: string };

export type Probe = (credential: Credential) => Promise<Access>;

/** The shape of a safe-return key (a URL-safe token); the backend decides if it is real. */
export const WATCH_KEY = /^[A-Za-z0-9_-]{20,100}$/;

/**
 * - granted: the key is real; the guest cookie was set.
 * - own: the signed-in user can already see this share; nothing was set.
 * - ended: the key is real but its access ended; nothing was set.
 * - invalid: not a key for this share; nothing was set.
 * - unavailable: the backend couldn't check it; nothing was set, try again.
 */
export type ClaimResult = "granted" | "own" | "ended" | "invalid" | "unavailable";

export function accessFromStatus(status: number | null): Access {
  switch (status) {
    case 200:
      return "granted";
    case 403:
      return "restricted";
    case 401:
    case 404:
    case 422:
      return "none";
    default:
      return "unknown";
  }
}

async function safely(probe: Probe, credential: Credential): Promise<Access> {
  try {
    return await probe(credential);
  } catch {
    return "unknown";
  }
}

/**
 * A safe-return link was opened. The key becomes this browser's guest cookie only if the backend
 * says it grants access to this share, and only if the signed-in user (if any) can't already see
 * it: a crafted link with a made-up key must never replace anyone's own access.
 */
export async function claimKey(
  key: string,
  deps: { userToken: string | null; probe: Probe; store(key: string): Promise<void> | void },
): Promise<ClaimResult> {
  if (!WATCH_KEY.test(key)) return "invalid";
  if (deps.userToken) {
    const own = await safely(deps.probe, { kind: "user", token: deps.userToken });
    if (own === "granted") return "own";
  }
  switch (await safely(deps.probe, { kind: "guest", token: key })) {
    case "granted":
      await deps.store(key);
      return "granted";
    case "restricted":
      return "ended";
    case "none":
      return "invalid";
    default:
      return "unavailable";
  }
}

/**
 * Which credential the live stream uses. With only one, that one. Signed in with a guest cookie
 * too, the user's own access comes first; the guest cookie is used only when it does better
 * (an emergency contact who happens to be signed into an unrelated account).
 */
export async function chooseCredential(input: {
  userToken: string | null;
  guestToken: string | null;
  probe: Probe;
}): Promise<Credential | null> {
  const { userToken, guestToken } = input;
  if (!userToken) return guestToken ? { kind: "guest", token: guestToken } : null;
  const user: Credential = { kind: "user", token: userToken };
  if (!guestToken) return user;
  const guest: Credential = { kind: "guest", token: guestToken };

  const [own, pass] = await Promise.all([safely(input.probe, user), safely(input.probe, guest)]);
  if (own === "granted") return user;
  if (pass === "granted") return guest;
  if (own === "restricted") return user;
  if (pass === "restricted") return guest;
  return user;
}
