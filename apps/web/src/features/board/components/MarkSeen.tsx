"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { markBoardSeen } from "@/features/board/actions";

type SeenState = "pending" | "done" | "skipped" | "failed";

/**
 * Marks the board posts this view rendered as seen: one call per view, after it shows, and only
 * for posts that weren't seen yet (`ids` is [] while viewing as, or when every post was seen).
 * "New" stays on them for this view; it goes from the next one. data-board-seen is the call's
 * state, for tests.
 */
export function MarkSeen({ ids }: { ids: number[] }): ReactNode {
  const [state, setState] = useState<SeenState>(ids.length > 0 ? "pending" : "skipped");
  // React runs effects twice in development: the ref keeps it to one call.
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current || ids.length === 0) return;
    sent.current = true;
    markBoardSeen(ids).then(setState, () => setState("failed"));
  }, [ids]);
  return <span hidden data-board-seen={state} />;
}
