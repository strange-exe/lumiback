import type { ReactNode } from "react";

import type { StudentRow } from "@/features/board/board";

/**
 * Board posts as a student reads them: stacked rows, each with its title (and "New", as text in
 * the heading, so it is part of the post's name), category and who it's from, the body as plain
 * text with its line breaks, and when it was posted and shows until. Rows arrive formatted on
 * the server (campus time). Bodies are text nodes: no HTML, markdown or links.
 */
export function BoardPosts({
  rows,
  level = 3,
}: {
  rows: StudentRow[];
  /** The heading level of each post's title (2 on /board, 3 under home's "Hostel board"). */
  level?: 2 | 3;
}): ReactNode {
  const Title = level === 2 ? "h2" : "h3";
  return (
    <ul className="flex flex-col divide-y divide-line rounded-sheet border border-line bg-surface">
      {rows.map((row) => (
        <li
          key={row.id}
          className="flex flex-col gap-2 px-5 py-4"
          data-new={row.isNew ? "true" : "false"}
        >
          <Title className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-bold text-ink">
            <span className="min-w-0 break-words">{row.title}</span>
            {row.isNew ? (
              <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-sm font-bold text-ink">
                New
              </span>
            ) : null}
          </Title>
          <p className="text-sm text-muted">
            {row.category}. From {row.from}
          </p>
          <p className="max-w-[65ch] whitespace-pre-line break-words text-ink">{row.body}</p>
          <p className="text-sm tabular-nums text-muted">
            {row.posted}. {row.until}.
          </p>
        </li>
      ))}
    </ul>
  );
}
