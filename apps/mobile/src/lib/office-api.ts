/** The hostel office's API calls. The server checks the role on every call, and limits a
 * warden to their own hostels' students. */
import { api } from "@/lib/api";
import type { Escalation, OfficeOuting, OfficeOverview, OfficeRequest } from "@/lib/types";

export const office = {
  overview: () => api<OfficeOverview>("/admin/overview"),
  requests: () => api<OfficeRequest[]>("/admin/requests"),
  decide: (id: string, approve: boolean, note: string | null) =>
    api<OfficeRequest>(`/admin/requests/${encodeURIComponent(id)}/decision`, {
      method: "POST",
      body: { approve, note },
    }),
  escalations: () => api<Escalation[]>("/admin/escalations"),
  resolve: (id: string, note: string | null) =>
    api<void>(`/admin/escalations/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      body: { note },
    }),
  outings: () => api<OfficeOuting[]>("/admin/outings"),
};
