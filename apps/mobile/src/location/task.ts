import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";

import { api, ApiError } from "@/lib/api";
import type { ShareSession } from "@/lib/types";
import { notifyFollowRequest, notifyShareEnded } from "@/notify/notify";
import { newRequests } from "@/notify/plan";

/**
 * Live location while sharing. Runs as an Android foreground service (a visible "Sharing your
 * location" notification), which needs only while-in-use permission: no background-location
 * declaration on Google Play. The service stops when the share ends, is stopped, or the app is
 * swiped away (killServiceOnDestroy).
 *
 * The same loop also watches the share for join requests and for the share ending elsewhere,
 * so the student hears about both without keeping the app open.
 */
export const LOCATION_TASK = "lumiback-live-location";
const ACTIVE_KEY = "lumiback.share";
const MIN_GAP_MS = 5_000; // the backend rate-limits location writes; never send faster than this
const CHECK_GAP_MS = 20_000; // how often to look for join requests

interface ActiveShare {
  sessionId: string;
  endsAt: string;
  /** Viewers already announced, so each request notifies once. */
  notified?: string[];
}

let lastSent = 0;
let lastChecked = 0;

async function activeShare(): Promise<ActiveShare | null> {
  const raw = await SecureStore.getItemAsync(ACTIVE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ActiveShare;
  } catch {
    return null;
  }
}

async function saveShare(share: ActiveShare): Promise<void> {
  await SecureStore.setItemAsync(ACTIVE_KEY, JSON.stringify(share));
}

let endingId: string | null = null;

/** The share ended on the server (time up, idle, stopped on the web): say why, then stop. */
async function endedElsewhere(share: ActiveShare): Promise<void> {
  if (endingId === share.sessionId) return; // a second fix arrived while we were ending
  endingId = share.sessionId;
  const view = await api<ShareSession>(`/sessions/${share.sessionId}`).catch(() => null);
  await stopSending();
  // Past ends_at the server reports "ended" before its sweep has recorded a reason.
  await notifyShareEnded(view?.ended_reason ?? (view ? "expired" : null));
}

async function checkRequests(share: ActiveShare): Promise<void> {
  const view = await api<ShareSession>(`/sessions/${share.sessionId}`);
  if (view.status !== "active") return endedElsewhere(share);
  const fresh = newRequests(view.viewers, share.notified ?? []);
  if (fresh.length === 0) return;
  for (const viewer of fresh) await notifyFollowRequest(viewer.name);
  await saveShare({ ...share, notified: [...(share.notified ?? []), ...fresh.map((v) => v.id)] });
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  LOCATION_TASK,
  async ({ data, error }) => {
    if (error || !data) return;
    const share = await activeShare();
    if (!share) return stopSending();
    if (new Date(share.endsAt).getTime() <= Date.now()) return endedElsewhere(share);

    const latest = data.locations.at(-1);
    if (latest && Date.now() - lastSent >= MIN_GAP_MS) {
      lastSent = Date.now();
      try {
        await api(`/sessions/${share.sessionId}/location`, {
          method: "PUT",
          body: {
            lat: latest.coords.latitude,
            lng: latest.coords.longitude,
            accuracy_m: Math.max(0, latest.coords.accuracy ?? 0),
            recorded_at: new Date(latest.timestamp).toISOString(),
          },
        });
      } catch (e) {
        // 404/409: the share ended elsewhere. 401: signed out (nothing to explain).
        // Anything else (offline, 5xx) is retried on the next fix.
        if (e instanceof ApiError && (e.status === 404 || e.status === 409)) {
          return endedElsewhere(share);
        }
        if (e instanceof ApiError && e.status === 401) return stopSending();
      }
    }

    if (Date.now() - lastChecked >= CHECK_GAP_MS) {
      lastChecked = Date.now();
      await checkRequests(share).catch(() => undefined); // offline: try on a later fix
    }
  },
);

export type StartResult = "started" | "denied" | "servicesOff";

/** Asks for while-in-use location and starts the foreground service for this share. */
export async function startSending(sessionId: string, endsAt: string): Promise<StartResult> {
  if (!(await Location.hasServicesEnabledAsync())) return "servicesOff";
  const { granted } = await Location.requestForegroundPermissionsAsync();
  if (!granted) return "denied";

  const previous = await activeShare();
  await saveShare({
    sessionId,
    endsAt,
    // Resuming the same share must not re-announce requests already shown.
    notified: previous?.sessionId === sessionId ? previous.notified : [],
  });
  lastSent = 0;
  lastChecked = 0;
  endingId = null;
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
      notificationColor: "#234e46",
      killServiceOnDestroy: true,
    },
  });
  return "started";
}

export async function stopSending(): Promise<void> {
  await SecureStore.deleteItemAsync(ACTIVE_KEY);
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => undefined);
  }
}

export async function isSending(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
}
