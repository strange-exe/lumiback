import type { Device } from "@/lib/types";

/**
 * Signed-in devices: pure helpers (no React, no server), shared by the account page and its
 * unit tests. Times are India Standard Time whatever the browser's zone, like every outing time.
 */

const ZONE = "Asia/Kolkata";

const PARTS = new Intl.DateTimeFormat("en-IN", {
  timeZone: ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const YEAR = new Intl.DateTimeFormat("en-IN", { timeZone: ZONE, year: "numeric" });

/**
 * "Sat 7 Nov, 9:14 PM" in IST; the year is added only when it isn't this year (IST), as in
 * "Mon 3 Nov 2025, 8:05 AM". Built from parts so the browser's punctuation can't creep in.
 */
export function deviceTime(iso: string | Date, now: Date = new Date()): string {
  const parts: Record<string, string> = {};
  for (const part of PARTS.formatToParts(new Date(iso))) parts[part.type] = part.value;
  const date = `${parts.weekday} ${parts.day} ${parts.month}`;
  const year = parts.year === YEAR.format(now) ? "" : ` ${parts.year}`;
  return `${date}${year}, ${parts.hour}:${parts.minute} ${(parts.dayPeriod ?? "").toUpperCase()}`;
}

/** A device from the API, or a row made from one: all the sign-out rules need. */
type Mark = Pick<Device, "current">;

export function deviceName(device: Device): string {
  return device.device?.trim() || "Unknown device";
}

/** Every row except this device gets its own Sign out (this one uses the normal Sign out). */
export function canSignOut(device: Mark): boolean {
  return !device.current;
}

/**
 * This device is in the list. When it isn't (it signed in before devices were named), the
 * server can't tell which row it is, so "Sign out of all other devices" isn't offered.
 */
export function knowsThisDevice(devices: readonly Mark[]): boolean {
  return devices.some((d) => d.current);
}

/** "Sign out of all other devices" needs this device in the list and at least one other. */
export function canSignOutOthers(devices: readonly Mark[]): boolean {
  return knowsThisDevice(devices) && devices.some((d) => !d.current);
}

export function signedOutNotice(count: number): string {
  if (count === 0) return "No other devices were signed in.";
  return count === 1 ? "Signed out of 1 device." : `Signed out of ${count} devices.`;
}

/** What the list shows for one device, with its times already formatted (server-side). */
export interface DeviceRow {
  id: string;
  name: string;
  current: boolean;
  signedIn: string;
  lastActive: string;
}

/**
 * This device first (its "last active" is only as fresh as its last token refresh, so the API
 * may list it below a phone used a minute ago), then the API's order: most recently active.
 */
export function deviceRows(devices: Device[], now: Date = new Date()): DeviceRow[] {
  const ordered = [...devices.filter((d) => d.current), ...devices.filter((d) => !d.current)];
  return ordered.map((d) => ({
    id: d.id,
    name: deviceName(d),
    current: d.current,
    signedIn: deviceTime(d.signed_in_at, now),
    lastActive: deviceTime(d.last_active_at, now),
  }));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A device id from a form, checked before it goes into the API path. */
export function isDeviceId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
