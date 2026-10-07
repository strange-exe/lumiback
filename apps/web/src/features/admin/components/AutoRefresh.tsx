"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

/** Re-render the page's server data every `seconds` while the tab is visible. */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }): ReactNode {
  const router = useRouter();
  useEffect(() => {
    const tick = (): void => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = window.setInterval(tick, seconds * 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, seconds]);
  return null;
}
