import Link from "next/link";
import type { ReactNode } from "react";

import { formatWhen } from "@/features/admin/format";
import { HOME_POSTS, seeAllText, studentRow, unseenIds } from "@/features/board/board";
import { BoardPosts } from "@/features/board/components/BoardPosts";
import { MarkSeen } from "@/features/board/components/MarkSeen";
import type { BoardPost } from "@/lib/types";

/**
 * Home's "Hostel board", below the main task (in or out): the newest few posts and a link to
 * the rest on /board. Nothing shows when the board is empty (or for staff, whose board is []).
 * `posts` is started with the page's other reads; null means it couldn't be loaded.
 */
export async function HomeBoard({
  posts,
  viewing,
}: {
  posts: Promise<BoardPost[] | null>;
  /** A developer viewing as: nothing is marked seen. */
  viewing: boolean;
}): Promise<ReactNode> {
  const all = await posts;
  if (all !== null && all.length === 0) return null;
  const shown = (all ?? []).slice(0, HOME_POSTS);
  const seeAll = all ? seeAllText(all.length) : null;
  return (
    <section aria-labelledby="home-board-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 id="home-board-heading" className="font-display text-xl text-ink">
          Hostel board
        </h2>
        {seeAll ? (
          <Link
            href="/board"
            className="flex min-h-11 items-center font-bold text-accent underline-offset-4 hover:underline"
          >
            {seeAll}
          </Link>
        ) : null}
      </div>
      {all === null ? (
        <p className="text-sm text-muted">
          Couldn&apos;t load the hostel board. Reload to try again.
        </p>
      ) : (
        <>
          <BoardPosts rows={shown.map((post) => studentRow(post, (iso) => formatWhen(iso)))} />
          <MarkSeen ids={viewing ? [] : unseenIds(shown)} />
        </>
      )}
    </section>
  );
}
