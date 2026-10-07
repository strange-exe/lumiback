"use client";

import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { DARK, LIGHT } from "@/components/hero/palette";

const CampusScene = lazy(() => import("@/components/hero/CampusScene"));

function subscribeDark(onChange: () => void): () => void {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const isDark = (): boolean => window.matchMedia("(prefers-color-scheme: dark)").matches;

/**
 * Live 3D only where it adds something and costs nothing important: a mouse or trackpad (the
 * scene's motion follows the pointer, so touch screens gain nothing for ~240 KB of three.js),
 * a wide screen, motion allowed, no data saver, and WebGL. Everyone else keeps the poster.
 */
function canRunScene(): boolean {
  if (!window.matchMedia("(pointer: fine) and (min-width: 768px)").matches) return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * The hero's 3D campus. Everyone first sees a pre-rendered poster of the same scene (sized, so no
 * layout shift); the live scene loads after the page is idle and fades in over it. Reduced
 * motion, data saver, or no WebGL: the poster is the final state. Offscreen: the scene pauses.
 */
export function HeroVisual({ className = "" }: { className?: string }): ReactNode {
  const box = useRef<HTMLDivElement>(null);
  const dark = useSyncExternalStore(subscribeDark, isDark, () => false);
  const [live, setLive] = useState(false);
  const [ready, setReady] = useState(false);
  const [onScreen, setOnScreen] = useState(true);

  useEffect(() => {
    if (!canRunScene()) return;
    const start = (): void => setLive(true);
    const idle = window.requestIdleCallback?.(start, { timeout: 2500 });
    const fallback = idle === undefined ? window.setTimeout(start, 1200) : undefined;
    return () => {
      if (idle !== undefined) window.cancelIdleCallback(idle);
      if (fallback !== undefined) window.clearTimeout(fallback);
    };
  }, []);

  useEffect(() => {
    if (!box.current) return;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), {
      rootMargin: "100px",
    });
    observer.observe(box.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={box} className={`relative aspect-[5/4] w-full ${className}`}>
      {/* Soft floor light behind the object, so it sits in space rather than on a flat page. */}
      <div
        aria-hidden="true"
        className="absolute inset-[8%] rounded-full bg-[radial-gradient(closest-side,var(--accent-soft),transparent)] opacity-80"
      />
      <picture>
        <source srcSet="/hero/campus-dark.webp" media="(prefers-color-scheme: dark)" />
        <img
          src="/hero/campus-light.webp"
          alt=""
          width={1000}
          height={800}
          fetchPriority="high"
          className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-700 ${
            ready ? "opacity-0" : "opacity-100"
          }`}
        />
      </picture>
      {live && (
        <div
          className={`absolute inset-0 transition-opacity duration-700 ${ready ? "opacity-100" : "opacity-0"}`}
          data-scene={ready ? "ready" : "loading"}
        >
          <Suspense fallback={null}>
            <CampusScene
              palette={dark ? DARK : LIGHT}
              still={!onScreen}
              onReady={() => setReady(true)}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}
