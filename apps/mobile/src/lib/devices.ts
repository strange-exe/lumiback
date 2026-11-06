/**
 * Signed-in devices (a lost phone): the pure rules behind the screen and the name this app
 * gives itself when it signs in. Contract: .claude/tasks/devices-contract.md; backend: the
 * "signed-in devices" section of backend/app/api/auth.py.
 */
import { ApiError } from "@/lib/api";
import type { Device } from "@/lib/types";

/** The backend refuses longer names (LoginIn.device, max 60). */
const MAX_NAME = 60;
// A version is digits, dots and maybe a codename ("14", "17.5", "Baklava"). Keeping only these
// means a custom ROM's odd string can never carry a character the backend refuses (control or
// invisible format characters), which would fail the whole sign-in with a 422.
const UNSAFE = /[^A-Za-z0-9._ -]/g;

/** The parts of React Native's Platform this needs (passed in, so tests need no mocks). */
export interface PlatformInfo {
  OS: string;
  /** Android: the API level (34), NOT the version people know. iOS: "17.5". */
  Version: string | number;
  /** Android only: Platform.constants.Release, the version people know ("14"). */
  release?: string;
}

/** "Lumiback app on Android 14", "Lumiback app on iOS 17.5", or "Lumiback app". */
export function deviceLabel({ OS, Version, release }: PlatformInfo): string {
  const clean = (text: string): string => text.replace(UNSAFE, "").trim();
  let label = "Lumiback app";
  if (OS === "android") {
    const version = clean(release ?? "");
    label = version ? `Lumiback app on Android ${version}` : "Lumiback app on Android";
  } else if (OS === "ios") {
    const version = clean(String(Version));
    label = version ? `Lumiback app on iOS ${version}` : "Lumiback app on iOS";
  }
  return label.slice(0, MAX_NAME).trim();
}

/** The name shown for a row. */
export function deviceName(device: Device): string {
  return device.device ?? "Unknown device";
}

/** Which icon a row gets: the app and phone browsers are phones, other browsers computers. */
export function deviceKind(device: Device): "phone" | "computer" | "unknown" {
  if (!device.device) return "unknown";
  return /Lumiback app|Android|iPhone|iPad|iOS/.test(device.device) ? "phone" : "computer";
}

/** Every row but this device: this one signs out with the normal Sign out button. */
export function canSignOut(device: Device): boolean {
  return !device.current;
}

/** Whether this phone is in the list at all (false when it signed in before devices had ids). */
export function hasCurrent(devices: Device[]): boolean {
  return devices.some((d) => d.current);
}

/**
 * "Sign out of all other devices" needs this device's own row (the server answers 409 without
 * it) and at least one other row to sign out.
 */
export function canSignOutOthers(devices: Device[]): boolean {
  return hasCurrent(devices) && devices.some((d) => !d.current);
}

/** Nothing to manage: only this phone is signed in (or nothing is listed). */
export function onlyThisDevice(devices: Device[]): boolean {
  return devices.every((d) => d.current);
}

/** After "Sign out of all other devices". */
export function signedOutMessage(count: number): string {
  if (count <= 0) return "No other devices were signed in.";
  return count === 1 ? "Signed out of 1 device." : `Signed out of ${count} devices.`;
}

/**
 * What to say when a sign-out fails. 404: the device was already gone (signed out elsewhere, or
 * its sign-in expired), so the list just needs a reload. 409 (this phone has no sign-in id) and
 * 429 (30 an hour) carry the backend's own sentence, as does any other refusal. Anything that
 * isn't an API error gets the fallback.
 */
export function deviceError(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;
  if (error.status === 404) return "That device was already signed out.";
  return error.detail || fallback;
}
