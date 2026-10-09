import "server-only";

import { callBackend } from "@/lib/backend";
import type {
  Campus,
  HostelChoice,
  Outing,
  OutingPage,
  OutingRequest,
  OutingSummary,
  Profile,
} from "@/lib/types";

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

  /** Today's rules; null if they couldn't be loaded (the server still applies them). */
  campus(token: string): Promise<Campus | null> {
    return callBackend<Campus>("/campus", { token }).catch(() => null);
  },

  request(token: string): Promise<OutingRequest | null> {
    return callBackend<OutingRequest | null>("/outings/request", { token });
  },

  profile(token: string): Promise<Profile> {
    return callBackend<Profile>("/profile", { token });
  },

  hostels(token: string): Promise<HostelChoice[]> {
    return callBackend<HostelChoice[]>("/hostels", { token });
  },
};
