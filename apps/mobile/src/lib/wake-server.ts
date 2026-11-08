import { useEffect } from "react";
import { AppState } from "react-native";

import { API_URL } from "@/lib/config";
import { createWakeGate } from "@/lib/wake";

// One gate for the whole app: the foreground and the scanner share the minute.
const gate = createWakeGate();

/**
 * Fire and forget GET /health, so a sleeping server starts waking now. No token or View as
 * header is sent, and the answer (or a failure) is ignored: the real request reports problems.
 */
export function wakeServer(): void {
  if (!gate.shouldWake(Date.now())) return;
  fetch(`${API_URL}/health`, { method: "GET", headers: { Accept: "application/json" } }).catch(
    () => undefined,
  );
}

/** Wakes the server whenever the app comes back to the foreground. */
export function useWakeOnForeground(): void {
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") wakeServer();
    });
    return () => sub.remove();
  }, []);
}
