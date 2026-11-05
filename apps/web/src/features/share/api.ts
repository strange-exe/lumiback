import "server-only";

import { callBackend } from "@/lib/backend";
import type { ShareSession, Watching } from "@/lib/types";

/** Reads for Server Components. Each call carries the student's own access token. */
export const shareApi = {
  /**
   * The share this browser sends location for: a live tab share (at most one is started from
   * the web), or the outing's safe-return share, which any tab of the student's picks up.
   */
  async activeTabShare(token: string): Promise<ShareSession | null> {
    const mine = await callBackend<ShareSession[]>("/sessions/mine", { token });
    const active = mine.filter((s) => s.status === "active");
    return (
      active.find((s) => s.source === "tab_live") ??
      active.find((s) => s.source === "outing") ??
      null
    );
  },

  /** One of my own shares (the owner's view). */
  session(token: string, id: string): Promise<ShareSession> {
    return callBackend<ShareSession>(`/sessions/${encodeURIComponent(id)}`, { token });
  },

  /** Sessions other students are sharing with me right now. */
  watching(token: string): Promise<Watching[]> {
    return callBackend<Watching[]>("/sessions/watching", { token });
  },
};
