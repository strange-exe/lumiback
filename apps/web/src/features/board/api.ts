import "server-only";

import type { BoardPostPayload, BoardTargetsBody } from "@/features/board/board";
import { callBackend } from "@/lib/backend";
import type { BoardDraft, BoardPost, BoardReach, BoardSent, StaffBoardPost } from "@/lib/types";

/** ?hostel_ids=<uuid>&hostel_ids=<uuid>, or ?all_hostels=true (backend/app/api/board.py). */
function targetQuery(targets: BoardTargetsBody): URLSearchParams {
  const query = new URLSearchParams();
  if (targets.all_hostels) query.set("all_hostels", "true");
  else for (const id of targets.hostel_ids) query.append("hostel_ids", id);
  return query;
}

/** The hostel office's side of the hostel board. The API checks the role and the hostels. */
export const boardApi = {
  /** The posts for this office's hostels and every all-hostels post, newest first (50). */
  async list(token: string): Promise<StaffBoardPost[]> {
    return (await callBackend<{ posts: StaffBoardPost[] }>("/admin/board", { token })).posts;
  },

  /** How many students a post would be for, and how many phones would get a notification. */
  reach(token: string, targets: BoardTargetsBody): Promise<BoardReach> {
    return callBackend<BoardReach>(`/admin/board/reach?${targetQuery(targets).toString()}`, {
      token,
    });
  },

  /** A timings post written from the outing rules these hostels follow. */
  draft(token: string, targets: BoardTargetsBody): Promise<BoardDraft> {
    return callBackend<BoardDraft>(`/admin/board/draft?${targetQuery(targets).toString()}`, {
      token,
    });
  },

  post(token: string, body: BoardPostPayload): Promise<BoardSent> {
    return callBackend<BoardSent>("/admin/board", { method: "POST", token, body });
  },

  /** `id` is a checked post id (1..2**63-1). Idempotent. */
  withdraw(token: string, id: string): Promise<void> {
    return callBackend<void>(`/admin/board/${id}/withdraw`, { method: "POST", token });
  },
};

/** The student's side: the board for their hostel ([] for anyone else, a developer viewing as too). */
export const studentBoardApi = {
  /** Active posts for the student's hostel and every all-hostels post, newest first (30). */
  async feed(token: string): Promise<BoardPost[]> {
    return (await callBackend<{ posts: BoardPost[] }>("/board", { token })).posts;
  },

  /** Marks these posts seen. Idempotent; ids the student can't see now are ignored. */
  seen(token: string, ids: number[]): Promise<void> {
    return callBackend<void>("/board/seen", { method: "POST", token, body: { ids } });
  },
};
