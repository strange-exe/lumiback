import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";

import { api, ApiError } from "@/lib/api";

/**
 * Live location while sharing. Runs as an Android foreground service (a visible "Sharing your
 * location" notification), which needs only while-in-use permission: no background-location
 * declaration on Google Play. The service stops when the share ends, is stopped, or the app is
 * swiped away (killServiceOnDestroy).
 */
export const LOCATION_TASK = "lumiback-live-location";
const ACTIVE_KEY = "lumiback.share";
const MIN_GAP_MS = 5_000; // the backend rate-limits location writes; never send faster than this

interface ActiveShare {
  sessionId: string;
  endsAt: string;
}

let lastSent = 0;

async function activeShare(): Promise<ActiveShare | null> {
  const raw = await SecureStore.getItemAsync(ACTIVE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ActiveShare;
  } catch {
    return null;
  }
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  LOCATION_TASK,
  async ({ data, error }) => {
    if (error || !data) return;
    const share = await activeShare();
    if (!share || new Date(share.endsAt).getTime() <= Date.now()) {
      await stopSending();
      return;
    }
    const latest = data.locations.at(-1);
    if (!latest || Date.now() - lastSent < MIN_GAP_MS) return;
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
      // 404/409: the share ended elsewhere (stopped on the web, expired, or idle-closed).
      // 401: signed out. Anything else (offline, 5xx) is retried on the next fix.
      if (e instanceof ApiError && [401, 404, 409].includes(e.status)) await stopSending();
    }
  },
);

export type StartResult = "started" | "denied" | "servicesOff";

/** Asks for while-in-use location and starts the foreground service for this share. */
export async function startSending(sessionId: string, endsAt: string): Promise<StartResult> {
  if (!(await Location.hasServicesEnabledAsync())) return "servicesOff";
  const { granted } = await Location.requestForegroundPermissionsAsync();
  if (!granted) return "denied";

  await SecureStore.setItemAsync(
    ACTIVE_KEY,
    JSON.stringify({ sessionId, endsAt } satisfies ActiveShare),
  );
  lastSent = 0;
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 10_000,
    distanceInterval: 10,
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
