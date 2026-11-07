import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";

import { api, ApiError } from "@/lib/api";
import type { ShareSession } from "@/lib/types";
import { notifyFollowRequest, notifySendProblem, notifyShareEnded } from "@/notify/notify";
import { hasPushToken } from "@/notify/push";
import { newRequests } from "@/notify/plan";

/**
 * Live location while sharing. Runs as an Android foreground service (a visible "Sharing your
 * location" notification), which needs only while-in-use permission: no background-location
 * declaration on Google Play. The service stops when the last share ends, is stopped, or the
 * app is swiped away (killServiceOnDestroy).
 *
 * The phone can send for more than one share at once: a share started on the Live tab and the
 * safe-return share a check-out starts. Each fix goes to every share; stopping one leaves the
 * other sending.
 *
 * The same loop also watches each share for join requests and for the share ending elsewhere,
 * so the student hears about both without keeping the app open.
 */
export const LOCATION_TASK = "lumiback-live-location";
const ACTIVE_KEY = "lumiback.share";
const MIN_GAP_MS = 5_000; // the backend rate-limits location writes; never send faster than this
const CHECK_GAP_MS = 20_000; // how often to look for join requests
const FUTURE = "recorded_at is in the future"; // backend FutureTimestamp detail (422)

/**
 * Why the server is refusing this phone's fixes, so the share can say so instead of "Live":
 * "clock" when the phone's clock is ahead of the server's, "refused" for any other 422.
 */
export type SendProblem = "clock" | "refused";

interface ActiveShare {
  sessionId: string;
  endsAt: string;
  /** Viewers already announced, so each request notifies once. */
  notified?: string[];
  /** Set while the server refuses the fixes; cleared by the next accepted one. */
  problem?: SendProblem;
}

const lastSent = new Map<string, number>();
const lastChecked = new Map<string, number>();

function isShare(value: unknown): value is ActiveShare {
  if (!value || typeof value !== "object") return false;
  const { sessionId, endsAt } = value as Partial<ActiveShare>;
  return typeof sessionId === "string" && typeof endsAt === "string";
}

/** The shares this phone sends for. An app from before two shares stored one share object. */
async function activeShares(): Promise<ActiveShare[]> {
  const raw = await SecureStore.getItemAsync(ACTIVE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const list =
      parsed && typeof parsed === "object" && Array.isArray((parsed as { shares?: unknown }).shares)
        ? (parsed as { shares: unknown[] }).shares
        : [parsed];
    return list.filter(isShare);
  } catch {
    return [];
  }
}

async function saveShares(shares: ActiveShare[]): Promise<void> {
  if (shares.length === 0) await SecureStore.deleteItemAsync(ACTIVE_KEY);
  else await SecureStore.setItemAsync(ACTIVE_KEY, JSON.stringify({ shares }));
}

/** Changes one stored share, if this phone still sends for it. */
async function updateShare(sessionId: string, patch: Partial<ActiveShare>): Promise<void> {
  const shares = await activeShares();
  if (!shares.some((s) => s.sessionId === sessionId)) return;
  await saveShares(shares.map((s) => (s.sessionId === sessionId ? { ...s, ...patch } : s)));
}

const ending = new Set<string>();

/** The share ended on the server (time up, idle, stopped on the web): say why, then stop it. */
async function endedElsewhere(share: ActiveShare): Promise<void> {
  if (ending.has(share.sessionId)) return; // a second fix arrived while we were ending
  ending.add(share.sessionId);
  // Already stopped on this phone (signed out, or another student signed in): a tick that
  // was under way has nothing to explain, and the next student must not see it.
  // A storage error reads as "still this share": ending it must never get stuck here.
  const stored = await activeShares().catch(() => [share]);
  if (!stored.some((s) => s.sessionId === share.sessionId)) return;
  const view = await api<ShareSession>(`/sessions/${share.sessionId}`).catch(() => null);
  await stopSending(share.sessionId);
  // Past ends_at the server reports "ended" before its sweep has recorded a reason.
  await notifyShareEnded(view?.ended_reason ?? (view ? "expired" : null));
}

async function checkRequests(share: ActiveShare): Promise<void> {
  const view = await api<ShareSession>(`/sessions/${share.sessionId}`);
  if (view.status !== "active") return endedElsewhere(share);
  const fresh = newRequests(view.viewers, share.notified ?? []);
  if (fresh.length === 0) return;
  // With server push the request already arrived as a push; don't show it twice.
  if (!(await hasPushToken())) {
    for (const viewer of fresh) await notifyFollowRequest(viewer);
  }
  await updateShare(share.sessionId, {
    notified: [...(share.notified ?? []), ...fresh.map((v) => v.id)],
  });
}

/** Sends one fix to one share. True when the server no longer knows the student (signed out). */
async function sendFix(share: ActiveShare, fix: Location.LocationObject): Promise<boolean> {
  try {
    await api(`/sessions/${share.sessionId}/location`, {
      method: "PUT",
      body: {
        lat: fix.coords.latitude,
        lng: fix.coords.longitude,
        accuracy_m: Math.max(0, fix.coords.accuracy ?? 0),
        recorded_at: new Date(fix.timestamp).toISOString(),
        // Android's flag for a fix from a mock-location app: the server keeps it apart so
        // viewers see it in red beside the last real position, never in its place.
        mocked: fix.mocked ?? false,
      },
    });
    if (share.problem) await updateShare(share.sessionId, { problem: undefined });
  } catch (e) {
    if (!(e instanceof ApiError)) return false; // retried on the next fix
    // 404/409: the share ended elsewhere. 401: signed out (nothing to explain).
    if (e.status === 404 || e.status === 409) {
      await endedElsewhere(share);
      return false;
    }
    if (e.status === 401) return true;
    // 422: the server refuses this fix (a phone clock more than 2 minutes fast), and will keep
    // refusing every one: record it so the app shows it, and tell the student once.
    if (e.status === 422) {
      const problem: SendProblem = e.detail === FUTURE ? "clock" : "refused";
      if (share.problem !== problem) {
        await updateShare(share.sessionId, { problem });
        await notifySendProblem(problem);
      }
    }
    // Anything else (offline, 5xx) is retried on the next fix.
  }
  return false;
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  LOCATION_TASK,
  async ({ data, error }) => {
    if (error || !data) return;
    const shares = await activeShares();
    if (shares.length === 0) return stopSending();
    const latest = data.locations.at(-1);

    for (const share of shares) {
      if (new Date(share.endsAt).getTime() <= Date.now()) {
        await endedElsewhere(share);
        continue;
      }
      if (latest && Date.now() - (lastSent.get(share.sessionId) ?? 0) >= MIN_GAP_MS) {
        lastSent.set(share.sessionId, Date.now());
        if (await sendFix(share, latest)) return stopSending();
      }
      if (Date.now() - (lastChecked.get(share.sessionId) ?? 0) >= CHECK_GAP_MS) {
        lastChecked.set(share.sessionId, Date.now());
        await checkRequests(share).catch(() => undefined); // offline: try on a later fix
      }
    }
  },
);

export type StartResult = "started" | "denied" | "servicesOff";

/**
 * Whether the phone's location is on, asking Android to turn it on when it's off. Without
 * the ask, every tap of "Send my location" with location off only repeated the same warning,
 * which looked like nothing happened. enableNetworkProviderAsync shows Google Play services'
 * own dialog; it rejects when the student declines (or the dialog can't be shown).
 * Docs: https://docs.expo.dev/versions/v57.0.0/sdk/location/#locationenablenetworkproviderasync
 */
export async function locationOn(): Promise<boolean> {
  if (await Location.hasServicesEnabledAsync()) return true;
  try {
    await Location.enableNetworkProviderAsync();
  } catch {
    return false;
  }
  // Resolved: the student accepted, and Play services has switched location on. (Reading
  // hasServicesEnabledAsync again right away can still see the old state.)
  return true;
}

/**
 * Asks for while-in-use location and starts the foreground service for this share, alongside
 * any other share the phone already sends for.
 */
export async function startSending(sessionId: string, endsAt: string): Promise<StartResult> {
  if (!(await locationOn())) return "servicesOff";
  const { granted } = await Location.requestForegroundPermissionsAsync();
  if (!granted) return "denied";

  const others = await activeShares().catch(() => []);
  const previous = others.find((s) => s.sessionId === sessionId);
  await saveShares([
    ...others.filter((s) => s.sessionId !== sessionId),
    // Resuming the same share must not re-announce requests already shown.
    { sessionId, endsAt, notified: previous?.notified ?? [] },
  ]);
  lastSent.delete(sessionId);
  lastChecked.delete(sessionId);
  ending.delete(sessionId);
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 15_000,
    // No distance filter: Android only reports after this many metres of movement, and a
    // student sitting still for 15 minutes would have the share closed as idle by the server.
    distanceInterval: 0,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: "Sharing your live location",
      notificationBody: "Open Lumiback to see who can view it or to stop.",
      notificationColor: "#e8501a",
      killServiceOnDestroy: true,
    },
  });
  return "started";
}

/**
 * Safe return: send location for the outing's share the same way a manual share does. The
 * share already exists (the check-out created it); this only starts the location service.
 */
export async function startOutingShare(sessionId: string): Promise<StartResult> {
  const share = await api<ShareSession>(`/sessions/${sessionId}`);
  return startSending(share.id, share.ends_at);
}

/** Back from an outing: stop sending for its safe-return share (the server has ended it). */
export async function stopOutingShare(sessionId: string | null | undefined): Promise<void> {
  if (!sessionId) return;
  if ((await sendingShareIds()).includes(sessionId)) await stopSending(sessionId);
}

/** The shares this phone is sending location for. Read them before stopSending(). */
export async function sendingShareIds(): Promise<string[]> {
  return (await activeShares()).map((s) => s.sessionId);
}

/**
 * Stops sending for one share (the service keeps running for any other), or with no id for
 * every share. Fail-safe: a storage error stops the service, so the phone never keeps sending.
 */
export async function stopSending(sessionId?: string): Promise<void> {
  let rest: ActiveShare[] = [];
  try {
    if (sessionId !== undefined) {
      rest = (await activeShares()).filter((s) => s.sessionId !== sessionId);
    }
    await saveShares(rest);
  } catch (error) {
    rest = [];
    throw error;
  } finally {
    // Stop the service even if storage failed: a storage error must not leave the phone
    // sending its location. If asking whether it runs fails, stop it anyway.
    if (sessionId !== undefined) {
      lastSent.delete(sessionId);
      lastChecked.delete(sessionId);
    }
    if (
      rest.length === 0 &&
      (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => true))
    ) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => undefined);
    }
  }
}

export async function isSending(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
}

/** Whether the service is running and sending for this share (not only for another one). */
export async function isSendingFor(sessionId: string): Promise<boolean> {
  const [running, ids] = await Promise.all([
    isSending(),
    sendingShareIds().catch((): string[] => []),
  ]);
  return running && ids.includes(sessionId);
}

/** Why the server refuses this share's fixes, or null when they go through (or it isn't sent). */
export async function sendProblem(sessionId: string): Promise<SendProblem | null> {
  const shares = await activeShares().catch(() => []);
  return shares.find((s) => s.sessionId === sessionId)?.problem ?? null;
}
