"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { startShare, stopShare } from "@/features/share/actions";
import type { ShareSession } from "@/lib/types";

export interface Fix {
  lat: number;
  lng: number;
  accuracy_m: number;
  recorded_at: string;
}

interface ShareContextValue {
  /** The running tab share, or null. */
  session: ShareSession | null;
  starting: boolean;
  fix: Fix | null;
  /** When the server last accepted a fix (ms since epoch). */
  sentAt: number | null;
  /** Why location is not coming through right now, in words a student can act on. */
  problem: string | null;
  /** Why the last share ended, for a one-line notice. */
  endedReason: string | null;
  /** The browser agreed to keep the screen on while sharing (Screen Wake Lock). */
  screenAwake: boolean;
  start(minutes: number): Promise<string | null>;
  stop(): Promise<string | null>;
  /** Replace the session after an approve/remove (the action returns the fresh view). */
  update(session: ShareSession): void;
  /** Ask for location again from a tap (needed after the student blocks, then allows it). */
  retry(): void;
}

const ShareContext = createContext<ShareContextValue | null>(null);

export function useShare(): ShareContextValue {
  const value = useContext(ShareContext);
  if (!value) throw new Error("useShare must be used inside <ShareProvider>");
  return value;
}

const MIN_GAP_MS = 4_000; // backend allows 120/min; one fix every few seconds is plenty
const HEARTBEAT_MS = 20_000; // a fresh fix even when standing still, so the share reads "live"
const POLL_MS = 5_000; // join requests show up within a few seconds
const WATCH: PositionOptions = { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 };
const HEARTBEAT: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 15_000,
  timeout: 15_000,
};
const FIRST: PositionOptions = { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 };

function explain(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return "Location is blocked for this site. Allow it in your browser's site settings, then try again.";
    case error.POSITION_UNAVAILABLE:
      return "Your device can't find its location right now. Turn on location or GPS and try again.";
    default:
      return "Finding your location is taking a while. Try again, ideally near a window or outside.";
  }
}

function toFix(position: GeolocationPosition): Fix {
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy_m: Math.min(Math.round(position.coords.accuracy), 100_000),
    recorded_at: new Date(position.timestamp).toISOString(),
  };
}

function firstPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("This browser can't share location."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, FIRST);
  });
}

/**
 * Runs a live tab share for as long as the student stays in the app, whichever page they're on.
 * Lives in the signed-in layout, which stays mounted across in-app navigation.
 *
 * Ending: the Stop button; closing the tab (a beacon on `pagehide`); or, if neither arrives,
 * the backend ends the share once this tab stops checking in. Nothing here can extend a share.
 */
export function ShareProvider({
  initial,
  children,
}: {
  initial: ShareSession | null;
  children: ReactNode;
}): ReactNode {
  const [session, setSession] = useState<ShareSession | null>(initial);
  const [starting, setStarting] = useState(false);
  const [fix, setFix] = useState<Fix | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [endedReason, setEndedReason] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0); // bump to restart location tracking
  const [screenAwake, setScreenAwake] = useState(false);
  const lastSent = useRef(0);
  const sending = useRef(false);

  const sessionId = session?.id ?? null;

  const end = useCallback((reason: string) => {
    setSession(null);
    setFix(null);
    setSentAt(null);
    setProblem(null);
    setEndedReason(reason);
  }, []);

  const refresh = useCallback(
    async (id: string) => {
      const response = await fetch(`/api/share/${id}`, { cache: "no-store" }).catch(() => null);
      if (!response) return; // offline for a moment; the next poll tries again
      if (response.status === 404) return end("ended");
      if (!response.ok) return;
      const fresh = (await response.json()) as ShareSession;
      if (fresh.status !== "active") end(fresh.ended_reason ?? "ended");
      else setSession((current) => (current?.id === fresh.id ? fresh : current));
    },
    [end],
  );

  const send = useCallback(
    async (id: string, next: Fix, force = false) => {
      if (sending.current || (!force && Date.now() - lastSent.current < MIN_GAP_MS)) return;
      sending.current = true;
      try {
        const response = await fetch(`/api/share/${id}/location`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });
        if (response.ok) {
          lastSent.current = Date.now();
          setSentAt(lastSent.current);
        } else if (response.status === 409 || response.status === 404) {
          await refresh(id); // ended elsewhere (time ran out, stopped on another tab)
        }
      } catch {
        // Network blip: the next fix or heartbeat tries again.
      } finally {
        sending.current = false;
      }
    },
    [refresh],
  );

  // Track and report location while a share is running.
  useEffect(() => {
    if (!sessionId || !("geolocation" in navigator)) return;
    const onFix = (position: GeolocationPosition): void => {
      const next = toFix(position);
      setFix(next);
      setProblem(null);
      void send(sessionId, next);
    };
    const onError = (error: GeolocationPositionError): void => setProblem(explain(error));
    const watchId = navigator.geolocation.watchPosition(onFix, onError, WATCH);
    const heartbeat = window.setInterval(() => {
      navigator.geolocation.getCurrentPosition(onFix, onError, HEARTBEAT);
    }, HEARTBEAT_MS);
    return () => {
      navigator.geolocation.clearWatch(watchId);
      window.clearInterval(heartbeat);
    };
  }, [sessionId, send, attempt]);

  // Pick up join requests, and notice a share that ended elsewhere.
  useEffect(() => {
    if (!sessionId) return;
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh(sessionId);
    }, POLL_MS);
    return () => window.clearInterval(poll);
  }, [sessionId, refresh]);

  // Keep the screen on while sharing: a locked phone pauses the page, and with it the share.
  // Browsers drop the lock whenever the tab is hidden, so take it again on return.
  useEffect(() => {
    if (!sessionId || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async (): Promise<void> => {
      if (document.visibilityState !== "visible" || (lock && !lock.released)) return;
      try {
        const next = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void next.release();
          return;
        }
        lock = next;
        setScreenAwake(true);
        next.addEventListener("release", () => setScreenAwake(false));
      } catch {
        setScreenAwake(false); // battery saver, or the browser said no
      }
    };
    void acquire();
    const onVisibility = (): void => void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void lock?.release();
    };
  }, [sessionId]);

  // Closing the tab ends the share. sendBeacon is delivered even as the page unloads.
  useEffect(() => {
    if (!sessionId) return;
    const warn = (event: BeforeUnloadEvent): void => event.preventDefault();
    const onHide = (event: PageTransitionEvent): void => {
      if (event.persisted) return; // kept in the back/forward cache; the tab is still open
      navigator.sendBeacon(`/api/share/${sessionId}/stop`);
    };
    window.addEventListener("beforeunload", warn);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("pagehide", onHide);
    };
  }, [sessionId]);

  const start = useCallback(
    async (minutes: number): Promise<string | null> => {
      setStarting(true);
      setEndedReason(null);
      try {
        // Ask for location first: nothing is created if the student can't (or won't) share it.
        let position: GeolocationPosition;
        try {
          position = await firstPosition();
        } catch (error) {
          const message =
            error instanceof GeolocationPositionError ? explain(error) : String(error);
          setProblem(message);
          return message;
        }
        const result = await startShare(minutes);
        if (!result.ok) return result.error;
        const first = toFix(position);
        setProblem(null);
        setFix(first);
        setSession(result.data);
        lastSent.current = 0;
        await send(result.data.id, first, true);
        return null;
      } finally {
        setStarting(false);
      }
    },
    [send],
  );

  const stop = useCallback(async (): Promise<string | null> => {
    if (!sessionId) return null;
    const result = await stopShare(sessionId);
    if (!result.ok) return result.error;
    end(result.data.ended_reason ?? "stopped_by_sharer");
    return null;
  }, [sessionId, end]);

  const update = useCallback(
    (fresh: ShareSession) => {
      if (fresh.status !== "active") end(fresh.ended_reason ?? "ended");
      else setSession(fresh);
    },
    [end],
  );

  const retry = useCallback(() => {
    setProblem(null);
    setAttempt((n) => n + 1);
  }, []);

  const value = useMemo<ShareContextValue>(
    () => ({
      session,
      starting,
      fix,
      sentAt,
      problem,
      endedReason,
      screenAwake,
      start,
      stop,
      update,
      retry,
    }),
    [session, starting, fix, sentAt, problem, endedReason, screenAwake, start, stop, update, retry],
  );
  return <ShareContext.Provider value={value}>{children}</ShareContext.Provider>;
}
