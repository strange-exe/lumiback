/**
 * Sending location from a browser is an explicit choice made in that browser tab. A signed-in
 * tab that merely loads a running share (an outing's safe return, or a share started in another
 * tab) shows it, but never reads or sends the location until someone taps "Share location from
 * this browser" there (or starts the share there). Pure (no React) so it runs under `node --test`.
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
