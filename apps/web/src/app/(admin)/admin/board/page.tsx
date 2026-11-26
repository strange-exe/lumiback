import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { adminApi } from "@/features/admin/api";
import { formatWhen } from "@/features/admin/format";
import { boardApi } from "@/features/board/api";
import {
  boardRow,
  canPostToBoard,
  draftTargets,
  postsToAllHostels,
  startTargets,
  type BoardTargetsBody,
} from "@/features/board/board";
import { BoardForm } from "@/features/board/components/BoardForm";
import { BoardList } from "@/features/board/components/BoardList";
import { ApiError } from "@/lib/api-error";
import { requireStaff } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/types";

export const metadata: Metadata = { title: "Hostel board" };

interface PageProps {
  searchParams: Promise<{ draft?: unknown }>;
}

/** A read the page can do without (the reach line, a ?draft= prefill): null when it fails. */
async function optional<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ApiError) return null;
    throw error;
  }
}

function hasTargets(targets: BoardTargetsBody): boolean {
  return targets.all_hostels || targets.hostel_ids.length > 0;
}

/**
 * The hostel board, the office's side: a new post for the hostels this person looks after
 * (every hostel, or "All hostels", for head wardens and admins), and what is on the board for
 * them. Wardens, head wardens and admins only: a developer as themselves gets a 404 (they never
 * post), and while viewing as a role the page is read-only. ?draft=<rule set id> (the rules
 * page's "Announce this change") starts the form with the hostels following that rule set and
 * their outing rules written out.
 */
export default async function BoardPage({ searchParams }: PageProps): Promise<ReactNode> {
  const { token, user, viewingAs } = await requireStaff();
  if (!canPostToBoard(user.role)) notFound();
  const params = await searchParams;

  const [found, posts] = await Promise.all([adminApi.myHostels(token), boardApi.list(token)]);
  const hostels = [...found].sort((a, b) => a.name.localeCompare(b.name));
  const everyHostel = postsToAllHostels(user.role);
  const noHostel = !everyHostel && hostels.length === 0;
  const fromDraft = draftTargets(
    typeof params.draft === "string" ? params.draft : undefined,
    hostels,
    everyHostel,
  );
  const start = startTargets(user.role, hostels, fromDraft);
  const [startReach, startDraft] = await Promise.all([
    !noHostel && hasTargets(start) ? optional(() => boardApi.reach(token, start)) : null,
    !noHostel && fromDraft ? optional(() => boardApi.draft(token, fromDraft)) : null,
  ]);
  const rows = posts.map((post) => boardRow(post, (iso) => formatWhen(iso)));
  const readOnly = viewingAs
    ? `Read-only while viewing as ${ROLE_LABEL[viewingAs]}: nothing can be posted or taken down.`
    : null;

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-title text-ink">Hostel board</h1>
        <p className="max-w-[65ch] text-muted">
          Timings, mess, laundry and maintenance news for your hostels&apos; students. A post stays
          on their home page until it ends or is taken down.
        </p>
      </div>

      {noHostel ? (
        <p className="rounded-sheet border border-dashed border-line px-5 py-8 text-center text-muted">
          You don&apos;t look after a hostel yet. Ask an admin to assign one.
        </p>
      ) : (
        <BoardForm
          hostels={hostels.map((h) => ({ id: h.id, name: h.name }))}
          allHostels={everyHostel}
          start={start}
          startReach={startReach}
          startDraft={startDraft}
          posts={posts}
          readOnly={readOnly}
        />
      )}

      <section aria-labelledby="board-list-heading" className="flex flex-col gap-3">
        <h2
          id="board-list-heading"
          tabIndex={-1}
          className="font-display text-xl text-ink focus:outline-none"
        >
          On the board for your hostels
        </h2>
        <BoardList rows={rows} readOnly={readOnly !== null} headingId="board-list-heading" />
      </section>
    </div>
  );
}
