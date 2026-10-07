import { useEffect, useState } from "react";

/** The current time, re-read every `everyMs` so "updated 2 min ago" stays true. */
export function useNow(everyMs = 5_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
