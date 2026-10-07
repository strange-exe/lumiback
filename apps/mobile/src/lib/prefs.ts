import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";
import { Appearance } from "react-native";

/**
 * Small on-device settings. Kept in SecureStore (not AsyncStorage) because the background
 * location task reads the notification switches too, and SecureStore is already a dependency.
 */
export interface Prefs {
  appearance: "system" | "light" | "dark";
  followRequests: boolean;
  returnReminders: boolean;
  shareStatus: boolean;
  onboarded: boolean;
}

const KEY = "lumiback.prefs";
export const DEFAULT_PREFS: Prefs = {
  appearance: "system",
  followRequests: true,
  returnReminders: true,
  shareStatus: true,
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
    for (const key of ["followRequests", "returnReminders", "shareStatus", "onboarded"] as const) {
      if (typeof stored[key] === "boolean") next[key] = stored[key];
    }
    return next;
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Reads once per process (app or background task) and applies the appearance. */
export function loadPrefs(): Promise<Prefs> {
  loaded ??= SecureStore.getItemAsync(KEY)
    .then(parsePrefs)
    .catch(() => DEFAULT_PREFS)
    .then((p) => {
      current = p;
      applyAppearance(p);
      listeners.forEach((l) => l());
      return p;
    });
  return loaded;
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
