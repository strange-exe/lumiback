/**
 * The developer Status section on Profile: which app build and update this phone runs (from
 * expo-updates, read in the screen), and the API's own report (GET /meta/status, developers
 * only). Pure, so the wording is tested without a phone.
 */

/** The API's answer: versions and the migration only, never settings or addresses. */
export interface ApiStatus {
  api_version: string;
  commit: string | null;
  database: {
    reachable: boolean;
    revision: string | null;
    /** null when the code has no migrations (the API sends `str | None`). */
    head: string | null;
    up_to_date: boolean;
  };
  server_time: string;
}

export interface AppFacts {
  /** The newest changelog entry this code ships with. */
  version: string;
  runtimeVersion: string | null;
  channel: string | null;
  updateId: string | null;
  createdAt: Date | null;
  isEmbeddedLaunch: boolean;
}

/** [label, value] pairs, shown in order. */
export type StatusRow = [string, string];

const short = (id: string) => id.replace(/-/g, "").slice(0, 8);

/** A hex commit SHA (7 to 40 characters), shortened; anything else isn't one. */
function shortCommit(value: string | null): string {
  const sha = value?.trim().toLowerCase() ?? "";
  return /^[0-9a-f]{7,40}$/.test(sha) ? sha.slice(0, 7) : "Not reported";
}

export function appStatusRows(facts: AppFacts, formatWhen: (iso: string) => string): StatusRow[] {
  const ran = !facts.isEmbeddedLaunch && facts.updateId;
  const rows: StatusRow[] = [
    ["App version", facts.version],
    ["Runtime", facts.runtimeVersion ? short(facts.runtimeVersion) : "Development build"],
    ["Channel", facts.channel ?? "None"],
    ["Update", ran ? short(facts.updateId!) : "Built-in code"],
  ];
  if (ran && facts.createdAt) rows.push(["Update made", formatWhen(facts.createdAt.toISOString())]);
  return rows;
}

function migration(db: ApiStatus["database"]): string {
  const expects = db.head ?? "no migrations";
  if (!db.reachable) return `Unknown: the database didn't answer (the code expects ${expects})`;
  if (!db.revision)
    return `Not migrated: the database has no revision (the code expects ${expects})`;
  if (db.up_to_date) return `Up to date (${db.revision})`;
  return `Behind: the database is at ${db.revision}, the code expects ${expects}`;
}

export function apiStatusRows(status: ApiStatus, formatWhen: (iso: string) => string): StatusRow[] {
  return [
    ["API version", status.api_version],
    ["API commit", shortCommit(status.commit)],
    ["Database", status.database.reachable ? "Reachable" : "Didn't answer"],
    ["Migration", migration(status.database)],
    ["Server time", formatWhen(status.server_time)],
  ];
}
