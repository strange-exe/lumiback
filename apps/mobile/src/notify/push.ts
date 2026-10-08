import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { api } from "@/lib/api";
import { loadPrefs } from "@/lib/prefs";
import { mutedChannels } from "@/notify/plan";

/**
 * Server push (follow requests, approvals, overdue reminders) through Expo's push service.
 *
 * The token is registered after sign-in, once notifications are allowed, and removed on sign-out
 * so a shared phone never shows the previous student's notifications. Everything here fails
 * quietly: without a Firebase config in the build (google-services.json) Android can't issue a
 * token, and the app falls back to its local notifications.
 */
const KEY = "lumiback.push-token";

let registering: Promise<void> | null = null;
let again = false; // asked again mid-flight (e.g. a switch flipped): run once more after

/** Registered with the server on this phone (the location service then skips its local copies). */
export async function hasPushToken(): Promise<boolean> {
  try {
    return Boolean(await SecureStore.getItemAsync(KEY));
  } catch {
    return false;
  }
}

async function register(): Promise<void> {
  if (Platform.OS !== "android") return;
  if (!(await Notifications.getPermissionsAsync()).granted) return; // asked elsewhere, in context
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  const muted = mutedChannels(await loadPrefs()); // the switches in Profile -> Notifications
  await api("/devices/push-token", { method: "POST", body: { token, platform: "android", muted } });
  await SecureStore.setItemAsync(KEY, token);
}

/**
 * Safe to call often (sign-in, app start, permission granted, a notification switch changed):
 * one attempt runs at a time.
 */
export function registerPush(): Promise<void> {
  if (registering) {
    again = true;
    return registering;
  }
  registering = register()
    .catch(() => undefined) // no Firebase config, offline, ...: local notifications still work
    .finally(() => {
      registering = null;
      if (again) {
        again = false;
        void registerPush();
      }
    });
  return registering;
}

/** The account is gone (deleted): its tokens went with it on the server. */
export async function forgetPushToken(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY).catch(() => undefined);
}

/** Before signing out: stop pushes to this phone for this account. */
export async function unregisterPush(): Promise<void> {
  try {
    const token = await SecureStore.getItemAsync(KEY);
    if (!token) return;
    await SecureStore.deleteItemAsync(KEY);
    await api("/devices/push-token/remove", {
      method: "POST",
      body: { token, platform: "android" },
    });
  } catch {
    // Signing out must never fail because of this; the server also moves a token to whoever
    // signs in next on this phone.
  }
}

/** Expo can rotate the token while the app runs; keep the server's copy current. */
export function watchPushToken(): () => void {
  const subscription = Notifications.addPushTokenListener(() => void registerPush());
  return () => subscription.remove();
}
