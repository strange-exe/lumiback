"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

/**
 * Re-render the page's server data every `seconds` while the tab is visible. Once a minute by
 * default (owner, 2026-11-27; was 30 s): every refresh is several API calls from the website's
 * one address, which the hosting's inbound limit counts for every open office tab at once.
 */
export function AutoRefresh({ seconds = 60 }: { seconds?: number }): ReactNode {
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
