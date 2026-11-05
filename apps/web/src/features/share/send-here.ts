/**
 * Sending location from a browser is an explicit choice made in that browser tab. A signed-in
 * tab that merely loads a running share (an outing's safe return, or a share started in another
 * tab) shows it, but never reads or sends the location until someone taps "Share location from
 * this browser" there (or starts the share there, or checks out with safe return there; see
 * outings/safe-return.ts). The choice is dropped on sign-out. Pure (no React) so it runs under
 * `node --test`.
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Which share this tab chose to send location for, or null. */
export interface SendHere {
  get(): string | null;
  set(sessionId: string | null): void;
  subscribe(listener: () => void): () => void;
}

const KEY = "lumiback.send-location-for";

/**
 * Remembered in sessionStorage: this tab only, kept across reloads, gone when the tab closes.
 * Storage can be missing or throw (private mode, blocked site data); the choice then lasts for
 * this page only, and nothing ever throws.
 */
export function createSendHere(storage: () => StorageLike | null): SendHere {
  let memory: string | null = null;
  let loaded = false;
  const listeners = new Set<() => void>();
  const store = (): StorageLike | null => {
    try {
      return storage();
    } catch {
      return null;
    }
  };
  return {
    get() {
      if (!loaded) {
        loaded = true;
        try {
          memory = store()?.getItem(KEY) ?? null;
        } catch {
          memory = null;
        }
      }
      return memory;
    },
    set(sessionId) {
      loaded = true;
      memory = sessionId;
      try {
        if (sessionId) store()?.setItem(KEY, sessionId);
        else store()?.removeItem(KEY);
      } catch {
        // Kept in memory for this page.
      }
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/**
 * Keep the tab's choice in step with the share the layout shows. Once none is shown (signed out,
 * account deleted) the choice is dropped, so signing in again in this tab, or as someone else on
 * a shared browser, never resumes sending without a new tap. Notifies only on a real change.
 */
export function syncChoice(store: SendHere, shownShareId: string | null): void {
  if (shownShareId === null && store.get() !== null) store.set(null);
}

/**
 * Signing out of the tab that sends a tab share stops it first: nobody is left signed in here to
 * stop it. A share another tab sends keeps running (that tab can stop it), and a safe-return share
 * belongs to the outing and ends when the student is back. Returns the share to stop, or null.
 */
export function shareToStopOnSignOut(
  session: { id: string; source: string } | null,
  sendingHere: boolean,
): string | null {
  return session && sendingHere && session.source === "tab_live" ? session.id : null;
}

export interface GeoLike {
  watchPosition(
    onFix: PositionCallback,
    onError: PositionErrorCallback,
    options: PositionOptions,
  ): number;
  clearWatch(id: number): void;
  getCurrentPosition(
    onFix: PositionCallback,
    onError: PositionErrorCallback,
    options: PositionOptions,
  ): void;
}

export interface TimersLike {
  setInterval(run: () => void, ms: number): number;
  clearInterval(id: number): void;
}

/**
 * Watch the location (plus a heartbeat fix) for a share this tab chose to send from. Returns the
 * cleanup, or undefined when nothing was started: no share, no geolocation, or not chosen here.
 */
export function startTracking(options: {
  sessionId: string | null;
  sendingHere: boolean;
  geolocation: GeoLike | null;
  timers: TimersLike;
  onFix: PositionCallback;
  onError: PositionErrorCallback;
  watch: PositionOptions;
  heartbeat: PositionOptions;
  heartbeatMs: number;
}): (() => void) | undefined {
  const { geolocation: geo, timers } = options;
  if (!options.sessionId || !options.sendingHere || !geo) return undefined;
  const watchId = geo.watchPosition(options.onFix, options.onError, options.watch);
  const beat = timers.setInterval(() => {
    geo.getCurrentPosition(options.onFix, options.onError, options.heartbeat);
  }, options.heartbeatMs);
  return () => {
    geo.clearWatch(watchId);
    timers.clearInterval(beat);
  };
}
