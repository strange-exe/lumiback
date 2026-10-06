import "server-only";

import { callBackend } from "@/lib/backend";
import type { ShareSession, Watching } from "@/lib/types";

/** Reads for Server Components. Each call carries the student's own access token. */
export const shareApi = {
  /** The student's live tab share, if one is running (at most one is started from the web). */
  async activeTabShare(token: string): Promise<ShareSession | null> {
    const mine = await callBackend<ShareSession[]>("/sessions/mine", { token });
    return mine.find((s) => s.source === "tab_live" && s.status === "active") ?? null;
  },

  /** Sessions other students are sharing with me right now. */
  watching(token: string): Promise<Watching[]> {
    return callBackend<Watching[]>("/sessions/watching", { token });
  },
};
