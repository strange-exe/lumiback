import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";
import { Appearance } from "react-native";

/**
 * Small on-device settings. Kept in SecureStore (not AsyncStorage) because the background
 * location task reads the notification switches too, and SecureStore is already a dependency.
 */
/** The colour themes (src/ui/theme.ts), in the order Profile > Appearance lists them. */
export const THEME_NAMES = ["gate", "led", "dusk"] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

function isThemeName(value: unknown): value is ThemeName {
  return THEME_NAMES.some((name) => name === value);
}

export interface Prefs {
  appearance: "system" | "light" | "dark";
  /** The colour theme. Per phone, not per account. */
  theme: ThemeName;
  followRequests: boolean;
  returnReminders: boolean;
  shareStatus: boolean;
  /** Notifications for new hostel board posts (server push only). */
  hostelBoard: boolean;
  onboarded: boolean;
}

const KEY = "lumiback.prefs";
export const DEFAULT_PREFS: Prefs = {
  appearance: "system",
  // Gate glass for everyone, existing users included (owner, 2026-11-25).
  theme: "gate",
  followRequests: true,
  returnReminders: true,
  shareStatus: true,
  hostelBoard: true,
  onboarded: false,
};

let current: Prefs = DEFAULT_PREFS;
let loaded: Promise<Prefs> | null = null;
const listeners = new Set<() => void>();

function applyAppearance(p: Prefs): void {
  Appearance.setColorScheme(p.appearance === "system" ? "unspecified" : p.appearance);
}

/** Merges stored values over the defaults, ignoring anything unknown or malformed. */
export function parsePrefs(raw: string | null): Prefs {
  if (!raw) return DEFAULT_PREFS;
  try {
    const stored = JSON.parse(raw) as Partial<Record<keyof Prefs, unknown>>;
    const next = { ...DEFAULT_PREFS };
    if (stored.appearance === "light" || stored.appearance === "dark") {
      next.appearance = stored.appearance;
    }
    if (isThemeName(stored.theme)) next.theme = stored.theme;
    for (const key of [
      "followRequests",
      "returnReminders",
      "shareStatus",
      "hostelBoard",
      "onboarded",
    ] as const) {
      if (typeof stored[key] === "boolean") next[key] = stored[key];
    }
    return next;
  } catch {
    return DEFAULT_PREFS;
  }
}

/** A switch in Profile -> Notifications. */
export type NotificationSwitch =
  "followRequests" | "returnReminders" | "shareStatus" | "hostelBoard";

/** The switches someone sees: the hostel board's only for students (staff get no board pushes). */
export function notificationSwitches(student: boolean): NotificationSwitch[] {
  const all: NotificationSwitch[] = ["followRequests", "returnReminders", "shareStatus"];
  return student ? [...all, "hostelBoard"] : all;
}

/** Profile's "All on": every switch this person sees is on. */
export function allSwitchesOn(prefs: Prefs, student: boolean): boolean {
  return notificationSwitches(student).every((key) => prefs[key]);
}

/**
 * Reads storage once per process (app or background task). Later calls return the prefs as they
 * are now, so a switch changed with setPrefs takes effect at once.
 */
export async function loadPrefs(): Promise<Prefs> {
  loaded ??= SecureStore.getItemAsync(KEY)
    .then(parsePrefs)
    .catch(() => DEFAULT_PREFS)
    .then((p) => {
      current = p;
      listeners.forEach((l) => l());
      return p;
    });
  await loaded;
  return current;
}

/**
 * Loads the prefs and applies the stored light or dark choice. The root layout runs this on every
 * mount and waits for it before its first frame, so neither mode nor colour theme flashes. Every
 * mount, not once per process: after a font or display size change Android recreates the Activity
 * while the JS process lives on, and expo-system-ui resets the night mode to app.json's
 * "automatic" in each Activity onCreate, which undoes the earlier Appearance.setColorScheme.
 */
export async function applyStoredAppearance(): Promise<void> {
  applyAppearance(await loadPrefs());
}

export async function setPrefs(patch: Partial<Prefs>): Promise<void> {
  current = { ...current, ...patch };
  if (patch.appearance) applyAppearance(current);
  listeners.forEach((l) => l());
  await SecureStore.setItemAsync(KEY, JSON.stringify(current));
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
