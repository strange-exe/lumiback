"use client";

import { useEffect, useState, type ReactNode } from "react";

import { formatTime } from "@/features/outings/time";
import { QrCode } from "@/features/kiosk/QrCode";
import type { KioskCode } from "@/lib/types";
import { useNow } from "@/lib/use-now";

const STORAGE_KEY = "lumiback.kiosk-token";
/** A code is still accepted for two windows after it stops being current (see gate_codes.py). */
const STILL_VALID_FOR_MS = 40_000;

type View =
  | { kind: "starting" }
  | { kind: "no-token" }
  | { kind: "replaced" }
  | { kind: "off"; message: string }
  | { kind: "code"; code: KioskCode; offline: boolean; countdownMs: number }
  | { kind: "offline" };

function readToken(): string | null {
  // The admin's link carries the token in the fragment (never sent to a server). Keep it on this
  // tablet and take it out of the address bar.
  const hash = new URLSearchParams(window.location.hash.slice(1)).get("k");
  try {
    if (hash) {
      localStorage.setItem(STORAGE_KEY, hash);
      history.replaceState(null, "", window.location.pathname);
      return hash;
    }
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return hash; // storage blocked: works until the page is reloaded
  }
}

function forgetToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // nothing stored
  }
}

/** Keep the tablet's screen on while the page is visible (re-acquired after it's hidden). */
function useWakeLock(): void {
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const acquire = async (): Promise<void> => {
      if (document.visibilityState !== "visible") return;
      try {
        lock = await navigator.wakeLock.request("screen");
      } catch {
        // denied (battery saver); the tablet's own settings must keep it on
      }
    };
    void acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      document.removeEventListener("visibilitychange", acquire);
      void lock?.release();
    };
  }, []);
}

/**
 * The gate tablet. Calls the API directly (not through the web app) so a kiosk left running only
 * keeps the API awake. Refreshes as each code expires; rides out short network drops on the
 * last code while it is still accepted.
 */
export function KioskScreen({ apiUrl }: { apiUrl: string }): ReactNode {
  const [view, setView] = useState<View>({ kind: "starting" });
  // 0 until mounted: a clock read during server rendering can cross a minute before the page
  // hydrates, and the mismatch makes React throw the server HTML away.
  const now = useNow(5_000);
  useWakeLock();

  useEffect(() => {
    const token = readToken();
    let timer: number | undefined;
    let stopped = false;
    let last: KioskCode | null = null;

    const later = (ms: number): void => {
      if (!stopped) timer = window.setTimeout(load, ms);
    };
    const offline = (): void => {
      const usable = last && Date.parse(last.refresh_at) + STILL_VALID_FOR_MS > Date.now();
      setView(
        usable && last
          ? { kind: "code", code: last, offline: true, countdownMs: 0 }
          : { kind: "offline" },
      );
      later(5_000);
    };

    async function load(): Promise<void> {
      if (!token) {
        setView({ kind: "no-token" });
        return;
      }
      let response: Response;
      try {
        response = await fetch(`${apiUrl}/kiosk/qr`, {
          headers: { "X-Kiosk-Token": token },
          cache: "no-store",
        });
      } catch {
        offline();
        return;
      }
      if (stopped) return;
      if (response.status === 401) {
        forgetToken();
        setView({ kind: "replaced" });
        return;
      }
      if (response.status === 423) {
        const body = (await response.json().catch(() => null)) as { detail?: string } | null;
        setView({ kind: "off", message: body?.detail ?? "This gate is switched off" });
        later(30_000);
        return;
      }
      if (!response.ok) {
        if (response.status === 429) later(15_000);
        else offline();
        return;
      }
      last = (await response.json()) as KioskCode;
      // Fetch just after the code rolls over. Clamped, so a tablet with a wrong clock still
      // refreshes at least every 20 s (each code stays valid for ~60 s).
      const wait = Math.min(
        20_000,
        Math.max(2_000, Date.parse(last.refresh_at) - Date.now() + 300),
      );
      setView({ kind: "code", code: last, offline: false, countdownMs: wait });
      later(wait);
    }

    void load();
    const wake = (): void => {
      if (document.visibilityState === "visible" && timer !== undefined) {
        window.clearTimeout(timer);
        void load();
      }
    };
    document.addEventListener("visibilitychange", wake);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [apiUrl]);

  return (
    <main className="flex min-h-dvh flex-col bg-hero text-on-hero">
      <header className="flex items-center justify-between gap-4 px-6 pt-6 sm:px-10 sm:pt-8">
        <span className="font-display text-xl">Lumiback</span>
        <span className="font-display text-title tabular-nums" aria-label="Time now">
          {now ? formatTime(new Date(now)) : ""}
        </span>
      </header>
      <Body view={view} />
    </main>
  );
}

function Body({ view }: { view: View }): ReactNode {
  switch (view.kind) {
    case "code":
      return <CodeView code={view.code} offline={view.offline} countdownMs={view.countdownMs} />;
    case "starting":
      return <Message title="Starting…" />;
    case "offline":
      return (
        <Message
          title="Reconnecting…"
          detail="Check the tablet's Wi-Fi or mobile data. This screen retries on its own."
        />
      );
    case "off":
      return (
        <Message
          title={view.message}
          detail="An admin can switch it back on in Admin → Gates. This screen checks every 30 seconds."
        />
      );
    case "replaced":
      return (
        <Message
          title="This kiosk link was replaced"
          detail="An admin made a new link for this gate. Open the new link on this tablet."
        />
      );
    case "no-token":
      return (
        <Message
          title="Set up this gate tablet"
          detail="An admin opens Admin → Gates, makes a kiosk link for this gate, and opens it here once. The tablet remembers it."
        />
      );
  }
}

function CodeView({
  code,
  offline,
  countdownMs,
}: {
  code: KioskCode;
  offline: boolean;
  countdownMs: number;
}): ReactNode {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-8 sm:px-10 landscape:flex-row landscape:gap-16">
      <div className="flex max-w-md flex-col gap-4 text-center landscape:text-left">
        <p className="text-sm font-bold tracking-wide text-hero-accent uppercase">
          Tap out · Tap in
        </p>
        <h1 className="font-display text-[clamp(2.25rem,5vw,3.5rem)] leading-[1.05]">
          {code.gate_name}
        </h1>
        <p className="text-lg text-hero-muted">
          Open the Lumiback app, tap <strong className="text-on-hero">Scan</strong>, and point your
          camera here.
        </p>
        <p
          aria-live="polite"
          className={offline ? "font-bold text-hero-danger" : "text-hero-muted"}
        >
          {offline
            ? "Offline: this code still works for a few seconds."
            : "New code every 20 seconds."}
        </p>
      </div>
      <div className="flex flex-col items-center gap-4">
        <div className="rounded-[28px] bg-white p-3 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]">
          <QrCode
            text={code.qr}
            label={`Gate code for ${code.gate_name}`}
            className={`block size-[min(78vw,52vh)] landscape:size-[min(42vw,70vh)] ${offline ? "opacity-60" : ""}`}
          />
        </div>
        <div className="h-1.5 w-full max-w-[min(78vw,52vh)] overflow-hidden rounded-full bg-hero-line landscape:max-w-[min(42vw,70vh)]">
          <div
            key={code.qr}
            className="kiosk-countdown h-full origin-left rounded-full bg-hero-accent"
            style={{ animationDuration: `${countdownMs}ms` }}
          />
        </div>
      </div>
    </div>
  );
}

function Message({ title, detail }: { title: string; detail?: string }): ReactNode {
  return (
    <div
      role="status"
      className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center"
    >
      <h1 className="font-display text-[clamp(1.75rem,4vw,2.75rem)] leading-tight">{title}</h1>
      {detail && <p className="max-w-lg text-lg text-hero-muted">{detail}</p>}
    </div>
  );
}
