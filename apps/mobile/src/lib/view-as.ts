import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";

import { isDeveloper, ROLE_LABEL } from "@/lib/office";
import type { User, ViewAsRole } from "@/lib/types";

/**
 * Developer "View as": the role whose screens a developer is looking at (read-only; the server
 * refuses every change). Requests still run as the developer, with the developer's own data:
 * only the screens change. Kept in SecureStore so it survives a restart, and in memory for the
 * API client (which adds the X-View-As-Role header) and the screens (the banner, the guards).
 *
 * This module makes no API calls (the client imports it).
 */
const KEY = "lumiback.view-as-role";

/** The roles a developer can view the app as, in the selector's order (after Developer). */
export const VIEW_AS_ROLES: readonly ViewAsRole[] = ["admin", "head_warden", "warden", "student"];

/** The server's 403 detail when the real account isn't a developer (any more). */
export const DEVELOPERS_ONLY = "View as is for developers only";
/** The server's 403 detail for any change while viewing as another role. */
export const READ_ONLY = "Read-only while viewing as another role";
/** The server's 400 detail for a role it doesn't know. */
export const UNKNOWN_ROLE = "Unknown role to view as";

/** One of the four viewable roles, or null for anything else (never "developer"). */
export function parseViewAsRole(value: unknown): ViewAsRole | null {
  return typeof value === "string" && (VIEW_AS_ROLES as readonly string[]).includes(value)
    ? (value as ViewAsRole)
    : null;
}

let current: ViewAsRole | null = null;
let loading: Promise<void> | null = null;
// Bumped by every set or clear: a stored value read after one of them must not overwrite it.
let changes = 0;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

/** Reads the stored role once (the first call at launch); later calls are free. */
export function loadViewAs(): Promise<ViewAsRole | null> {
  if (!loading) {
    const at = changes;
    loading = (async () => {
      try {
        const role = parseViewAsRole(await SecureStore.getItemAsync(KEY));
        if (changes !== at || !role) return;
        current = role;
        emit();
      } catch {
        // Unreadable: the developer simply isn't viewing as another role.
      }
    })();
  }
  return loading.then(() => current);
}

/** The role being viewed right now, or null (the developer's own view). */
export function viewingAs(): ViewAsRole | null {
  return current;
}

/** Views the app as `role`; anything but the four viewable roles is ignored. */
export async function setViewAs(role: ViewAsRole): Promise<void> {
  const valid = parseViewAsRole(role);
  if (!valid) return;
  changes += 1;
  const was = current;
  current = valid;
  if (was !== valid) emit();
  // In memory it applies at once; storage only keeps it over a restart (best effort).
  await SecureStore.setItemAsync(KEY, valid).catch(() => undefined);
}

/**
 * Back to the developer's own view. With `role`, only when that role is still the one being
 * viewed, so a late refusal of an earlier choice never ends a newer one.
 */
export async function clearViewAs(role?: ViewAsRole): Promise<void> {
  if (role !== undefined && current !== role) return;
  changes += 1;
  const was = current;
  current = null;
  if (was) emit();
  await SecureStore.deleteItemAsync(KEY).catch(() => undefined);
}

export function subscribeViewAs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The role being viewed, re-rendering when it changes. */
export function useViewAs(): ViewAsRole | null {
  return useSyncExternalStore(subscribeViewAs, viewingAs, viewingAs);
}

/** The header a signed-in request carries while viewing as a role (none otherwise). */
export function viewAsHeaders(role: ViewAsRole | null): Record<string, string> {
  const valid = parseViewAsRole(role);
  return valid ? { "X-View-As-Role": valid } : {};
}

/**
 * The server says this view can't go on (this account isn't a developer, or the role is
 * unknown): the stored role must be cleared here too.
 */
export function refusesViewAs(status: number, detail: string): boolean {
  return (
    (status === 403 && detail === DEVELOPERS_ONLY) || (status === 400 && detail === UNKNOWN_ROLE)
  );
}

/** A change refused because the app is viewing as another role (read-only). */
export function isReadOnlyRefusal(status: number, detail: string): boolean {
  return status === 403 && detail === READ_ONLY;
}

/** The banner's words: "Viewing as Student. Read-only." */
export function viewAsLine(role: ViewAsRole): string {
  return `Viewing as ${ROLE_LABEL[role]}. Read-only.`;
}

/**
 * Whether this signed-in user may use View as: a developer, or a developer already viewing as
 * a role (then `/auth/me` reports the viewed role, and `viewing_as` says so).
 */
export function canViewAs(user: Pick<User, "role" | "viewing_as"> | null | undefined): boolean {
  if (!user) return false;
  return isDeveloper(user.role) || parseViewAsRole(user.viewing_as) !== null;
}
