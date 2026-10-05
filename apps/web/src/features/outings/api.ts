import "server-only";

import { callBackend } from "@/lib/backend";
import type { Outing, OutingPage, OutingSummary } from "@/lib/types";

/** Reads for Server Components. Each call carries the student's own access token. */
export const outingsApi = {
  current(token: string): Promise<Outing | null> {
    return callBackend<Outing | null>("/outings/current", { token });
  },

  history(token: string, before?: string): Promise<OutingPage> {
    const query = new URLSearchParams({ limit: "20" });
    if (before) query.set("before", before);
    return callBackend<OutingPage>(`/outings?${query.toString()}`, { token });
  },

  summary(token: string): Promise<OutingSummary> {
    return callBackend<OutingSummary>("/outings/summary", { token });
  },
};
