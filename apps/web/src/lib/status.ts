/**
 * The developer's Status page (app/(admin)/admin/status): what GET /meta/status returns, and
 * how its facts read in words. Pure (no Next.js imports), so `node --test` can load it.
 */

export interface DatabaseStatus {
  reachable: boolean;
  revision: string | null;
  head: string | null;
  up_to_date: boolean;
}

export interface ApiStatus {
  api_version: string;
  commit: string | null;
  database: DatabaseStatus;
  server_time: string;
}

/** A deployed commit (Render's RENDER_GIT_COMMIT) only if it's a hex SHA; anything else: null. */
export function commitOf(value: string | null | undefined): string | null {
  const v = (value ?? "").trim().toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(v) ? v : null;
}

export function shortCommit(commit: string | null): string {
  return commit ? commit.slice(0, 7) : "Not reported (not deployed from Git)";
}

export function migrationLine(db: DatabaseStatus): string {
  const expects = db.head ?? "no migrations";
  if (!db.reachable) return `Unknown: the database didn't answer (the code expects ${expects})`;
  if (db.revision === null) {
    return `Not migrated: the database has no revision (the code expects ${expects})`;
  }
  if (db.up_to_date) return `Up to date (${db.revision})`;
  return `Behind: the database is at ${db.revision}, the code expects ${expects}`;
}
