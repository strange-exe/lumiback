import { Linking } from "react-native";

import type { StartResult } from "@/location/task";

/**
 * Opens the Android settings page that fixes a failed start: the phone's location switch when
 * location is off, otherwise Lumiback's own app settings (location permission). Falls back to
 * the app settings if the location page can't be opened.
 * Docs: https://reactnative.dev/docs/linking#sendintent-android
 */
export async function openLocationSettings(
  problem: Exclude<StartResult, "started">,
): Promise<void> {
  if (problem === "servicesOff") {
    try {
      await Linking.sendIntent("android.settings.LOCATION_SOURCE_SETTINGS");
      return;
    } catch {
      // Some phones have no such page: the app settings still lead to location.
    }
  }
  await Linking.openSettings();
}

/** The settings button's label for a failed start. */
export function settingsLabel(problem: Exclude<StartResult, "started">): string {
  return problem === "servicesOff" ? "Turn on location" : "Open settings";
}
