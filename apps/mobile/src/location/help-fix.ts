import * as Location from "expo-location";

import { toHelpFix } from "@/lib/alerts";
import type { HelpFix } from "@/lib/types";

const FIX_TIMEOUT_MS = 10_000;

/**
 * One location fix for a help alert, or null. Never asks for permission (Help must not wait on
 * a prompt): only when the student already allowed location for the gate or a live share. No
 * "turn on location" dialog either, and at most 10 seconds, so help goes out without a fix
 * rather than late. One fix only, never tracking.
 * Docs: https://docs.expo.dev/versions/v57.0.0/sdk/location/
 */
export async function helpFix(): Promise<HelpFix | null> {
  try {
    const { granted } = await Location.getForegroundPermissionsAsync();
    if (!granted) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), FIX_TIMEOUT_MS);
    });
    const fix = await Promise.race([
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        mayShowUserSettingsDialog: false,
      }).catch(() => null), // location switched off, or no fix
      timeout,
    ]);
    clearTimeout(timer);
    return toHelpFix(fix);
  } catch {
    return null;
  }
}
