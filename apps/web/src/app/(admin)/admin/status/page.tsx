import type { Metadata } from "next";
import type { ReactNode } from "react";

import { formatWhen } from "@/features/admin/format";
import { announceDraft, announceTiming, type AnnounceState } from "@/features/developer/announce";
import { AnnounceForm } from "@/features/developer/components/AnnounceForm";
import { ApiError, callBackend } from "@/lib/backend";
import { CURRENT } from "@/lib/changelog";
import { requireDeveloper } from "@/lib/session";
import { commitOf, migrationLine, shortCommit, type ApiStatus } from "@/lib/status";

export const metadata: Metadata = { title: "Status" };

/**
 * For developers: which API and website builds are running, and whether the database has every
 * migration. Only versions, commits and the migration: never settings, addresses or keys (the
 * API's /meta/status is as small on purpose). Also where a release is announced to every phone.
 * A 404 for everyone else (requireDeveloper).
 */
export default async function StatusPage(): Promise<ReactNode> {
  const { token } = await requireDeveloper();
  const api = await callBackend<ApiStatus>("/meta/status", { token }).catch((error: unknown) => {
    if (error instanceof ApiError) return error;
    throw error;
  });
  // Render sets RENDER_GIT_COMMIT on each deploy; only a hex SHA is shown.
  const webCommit = commitOf(process.env.RENDER_GIT_COMMIT);
  const announced = await callBackend<AnnounceState>("/admin/announcements", { token }).catch(
    () => null,
  );
  // Rendered per request: the server's clock says whether the next one is allowed yet.
  const now = new Date().getTime();
  const timing = announced ? announceTiming(announced, now, formatWhen) : null;

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-title text-ink">Status</h1>
        <p className="text-muted">
          What&apos;s running now. Checked when this page opened: reload to check again.
        </p>
      </div>

      <Facts title="API">
        {api instanceof ApiError ? (
          <p role="alert" className="font-bold text-danger">
            The API didn&apos;t answer: {api.detail}
          </p>
        ) : (
          <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-4 gap-y-3">
            <Fact term="Version">{api.api_version}</Fact>
            <Fact term="Commit">{shortCommit(api.commit)}</Fact>
            <Fact term="Database">{api.database.reachable ? "Reachable" : "Didn't answer"}</Fact>
            <Fact term="Migration">
              <span className={api.database.up_to_date ? "text-ink" : "font-bold text-danger"}>
                {migrationLine(api.database)}
              </span>
            </Fact>
            <Fact term="Server time">{formatWhen(api.server_time)}</Fact>
          </dl>
        )}
      </Facts>

      <Facts title="Website">
        <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-4 gap-y-3">
          <Fact term="Version">{CURRENT.version}</Fact>
          <Fact term="Released">{CURRENT.date}</Fact>
          <Fact term="Commit">{shortCommit(webCommit)}</Fact>
        </dl>
      </Facts>

      <AnnounceForm
        last={timing?.last ?? "Couldn't check when the last update was announced."}
        next={timing?.next ?? "The API refuses a second one within a day."}
        draft={announceDraft(CURRENT)}
      />
    </div>
  );
}

function Facts({ title, children }: { title: string; children: ReactNode }): ReactNode {
  const id = `status-${title.toLowerCase()}`;
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-4 rounded-sheet border border-line bg-surface p-5"
    >
      <h2 id={id} className="font-display text-xl text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }): ReactNode {
  return (
    <>
      <dt className="text-sm text-muted">{term}</dt>
      <dd className="min-w-0 break-words text-sm tabular-nums text-ink">{children}</dd>
    </>
  );
}
