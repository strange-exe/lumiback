import { router } from "expo-router";

/** Where an announcement goes when there's nothing to install. */
export const WHATS_NEW = "/profile/whats-new";

const listeners = new Set<() => void>();

/**
 * An "app updated" notification was tapped. The update prompt (UpdatePrompt.tsx) listens: it
 * checks for the update now and, if there is one, downloads it and restarts in its sheet (with
 * the progress bar); What's new then shows on the new version. No update (already on it, or
 * offline): What's new opens. Builds without updates (development, Expo Go) never mount the
 * prompt, so nothing listens: What's new as well.
 */
export function openAnnouncedUpdate(): void {
  if (listeners.size === 0) {
    router.navigate(WHATS_NEW);
    return;
  }
  for (const listener of listeners) listener();
}

/** The update prompt's subscription; returns the unsubscribe. */
export function onAnnouncedUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
