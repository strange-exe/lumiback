import type { Metadata } from "next";
import type { ReactNode } from "react";

import { formatWhen } from "@/features/admin/format";
import { studentBoardApi } from "@/features/board/api";
import { studentRow, unseenIds } from "@/features/board/board";
import { BoardPosts } from "@/features/board/components/BoardPosts";
import { MarkSeen } from "@/features/board/components/MarkSeen";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Hostel board" };

/**
 * The whole hostel board for the student's hostel (home shows the newest few): what the hostel
 * office posted for it or for every hostel, newest first. The posts shown are marked seen.
 */
export default async function BoardPage(): Promise<ReactNode> {
  const { token, viewingAs } = await requireUser();
  const posts = await studentBoardApi.feed(token);

  return (
    <section aria-labelledby="board-heading" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 id="board-heading" className="font-display text-title text-ink">
          Hostel board
        </h1>
        <p className="max-w-[65ch] text-muted">
          What the hostel office posts for your hostel: timings, mess, laundry and maintenance. Each
          post shows until its end date.
        </p>
      </div>
      {posts.length === 0 ? (
        <p className="rounded-sheet border border-dashed border-line px-5 py-8 text-center text-muted">
          Nothing on your hostel&apos;s board right now.
        </p>
      ) : (
        <>
          <BoardPosts
            level={2}
            rows={posts.map((post) => studentRow(post, (iso) => formatWhen(iso)))}
          />
          <MarkSeen ids={viewingAs ? [] : unseenIds(posts)} />
        </>
      )}
    </section>
  );
}
