"use client";

import { useEffect, useState } from "react";

/** The current time, re-rendering every `everyMs`. Starts at 0 so server and client HTML match. */
export function useNow(everyMs = 1_000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = (): void => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, everyMs);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [everyMs]);
  return now;
}
