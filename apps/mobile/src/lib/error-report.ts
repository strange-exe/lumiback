/**
 * Reporting what broke to Lumiback's API (POST /errors). The API scrubs every report before
 * storing it; this side only keeps reports few and safe to send:
 * - the screen's path only, never a query string or fragment (nor a gate's code);
 * - a body that always fits the API's byte cap (the stack's end is cut to fit);
 * - each error once per run (by its message and first stack frame), and at most a few;
 * - one failed send turns reporting off for the rest of the run, so a broken /errors can never
 *   cause a loop of reports about itself;
 * - a crash's report is saved before it is sent and sent again on the next launch: the app
 *   usually dies before the request leaves;
 * - nothing here throws or logs: a reporter that fails must stay silent.
 * The same rules as the website's (apps/web/src/lib/error-report.ts). Pure, so it is unit-tested.
 */

export const LIMITS = { message: 500, stack: 8000, route: 300 } as const;
/**
 * The most a report's JSON may take, in UTF-8 bytes. The API refuses a body over 16 KB
 * (backend app/api/errors.py MAX_BODY_BYTES) and the fields' caps are in characters: 8000
 * characters of Devanagari are 24 000 bytes. Kept under the cap, as the website's is.
 */
export const MAX_BODY_BYTES = 15 * 1024;
const MAX_PER_RUN = 5;
/** A saved crash report older than this is dropped unsent: the build is likely replaced. */
const KEEP_PENDING_MS = 7 * 24 * 3600 * 1000;

export interface ErrorPayload {
  message: string;
  stack: string | null;
  route: string | null;
  app_version?: string;
  platform: "web" | "android" | "ios";
}

/** A message and stack from whatever was thrown, or null when there is nothing to report. */
export function describeError(error: unknown): { message: string; stack: string | null } | null {
  if (error === null || error === undefined || error === "") return null;
  try {
    if (error instanceof Error) {
      const message = error.message ? `${error.name}: ${error.message}` : error.name;
      return { message, stack: typeof error.stack === "string" ? error.stack : null };
    }
    if (typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
      return { message: (error as { message: string }).message, stack: null };
    }
    return { message: String(error), stack: null };
  } catch {
    return { message: "Unknown error", stack: null }; // e.g. an object without toString
  }
}

/**
 * The path alone: a query string or fragment can carry a code or a token. A gate's link
 * (/g/<code>) carries the gate's rotating code in the path itself, so it is never sent.
 */
export function pathOnly(route: string): string {
  const path = route.split(/[?#]/, 1)[0]!;
  return (/^\/g\/./.test(path) ? "/g/[code]" : path).slice(0, LIMITS.route);
}

/** The first `end` UTF-16 units, one fewer if that would split a two-unit character. */
function cut(text: string, end: number): string {
  if (text.length <= end) return text;
  const last = text.charCodeAt(end - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? end - 1 : end);
}

/** How many bytes `text` takes in UTF-8 (counted by hand: no TextEncoder needed). */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4; // a pair: one character
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * The payload with its stack cut, if need be, until the JSON body fits MAX_BODY_BYTES. The
 * start of a stack (where it broke) matters most, so the end goes. The other fields' caps are
 * small enough to always fit (500 and 300 characters, at most 6 bytes each escaped).
 */
function fit(payload: ErrorPayload): ErrorPayload {
  const size = (stack: string | null) => utf8Length(JSON.stringify({ ...payload, stack }));
  const stack = payload.stack;
  if (!stack || size(stack) <= MAX_BODY_BYTES) return payload;
  let fits = 0;
  let over = stack.length;
  while (over - fits > 1) {
    const middle = Math.floor((fits + over) / 2);
    if (size(cut(stack, middle)) <= MAX_BODY_BYTES) fits = middle;
    else over = middle;
  }
  return { ...payload, stack: fits > 0 ? cut(stack, fits) : null };
}

function firstFrame(stack: string | null): string {
  return stack?.split("\n").find((line) => /^\s*at\s|@/.test(line)) ?? "";
}

/**
 * Where a crash's report waits for the next launch. Synchronous on purpose: a fatal error's
 * handler must have saved it before React Native ends the app.
 */
export interface PendingStore {
  read: () => string | null;
  write: (raw: string) => void;
  clear: () => void;
}

/** Resolves true when the report was taken, false when refused; rejects when unreachable. */
type Send = (payload: ErrorPayload) => Promise<boolean>;

interface ReporterOptions {
  platform: ErrorPayload["platform"];
  version?: string;
  /** The current screen's path, read when an error is reported. */
  route: () => string | null;
  send: Send;
  /** Saves fatal errors' reports for the next launch (see sendPending). */
  pending?: PendingStore;
  max?: number;
}

function quietly(work: () => void): void {
  try {
    work();
  } catch {
    // Storage is a nice to have: never the next error.
  }
}

export function createReporter(options: ReporterOptions): {
  report: (error: unknown, fatal?: boolean) => void;
} {
  const seen = new Set<string>();
  let off = false;
  const max = options.max ?? MAX_PER_RUN;

  function stop(): void {
    off = true;
  }

  return {
    report(error: unknown, fatal = false): void {
      if (off || seen.size >= max) return;
      const described = describeError(error);
      if (!described) return;
      const { message, stack } = described;
      const key = `${message}\n${firstFrame(stack)}`;
      if (seen.has(key)) return;
      seen.add(key);
      try {
        const route = options.route();
        const draft: ErrorPayload = {
          message: cut(message, LIMITS.message),
          stack: stack ? cut(stack, LIMITS.stack) : null,
          route: route ? pathOnly(route) : null,
          platform: options.platform,
        };
        if (options.version) draft.app_version = options.version;
        const payload = fit(draft);
        // A crash: saved first, since the app may be gone before the send below leaves.
        const store = fatal ? options.pending : undefined;
        if (store) quietly(() => store.write(JSON.stringify({ at: Date.now(), payload })));
        options.send(payload).then((ok) => {
          if (store) quietly(() => store.clear()); // taken or refused: either way, done
          if (!ok) stop();
        }, stop);
      } catch {
        stop();
      }
    },
  };
}

function parsePending(raw: string, now: number): ErrorPayload | null {
  try {
    const saved = JSON.parse(raw) as { at?: unknown; payload?: Partial<ErrorPayload> | null };
    const p = saved.payload;
    if (typeof saved.at !== "number" || now - saved.at > KEEP_PENDING_MS || !p) return null;
    if (typeof p.message !== "string" || !p.message) return null;
    if (p.platform !== "android" && p.platform !== "ios") return null;
    return fit({
      message: cut(p.message, LIMITS.message),
      stack: typeof p.stack === "string" ? cut(p.stack, LIMITS.stack) : null,
      route: typeof p.route === "string" ? pathOnly(p.route) : null,
      platform: p.platform,
      ...(typeof p.app_version === "string" ? { app_version: p.app_version } : {}),
    });
  } catch {
    return null;
  }
}

/**
 * At launch: the report a crash saved last time, if any, sent once. Kept only when the API
 * couldn't be reached (offline), for the launch after; an answer, even a refusal, ends it,
 * so a report the API won't take is never sent forever. Never throws.
 */
export async function sendPending(store: PendingStore, send: Send): Promise<void> {
  let raw: string | null = null;
  try {
    raw = store.read();
  } catch {
    return;
  }
  if (!raw) return;
  const payload = parsePending(raw, Date.now());
  if (!payload) {
    quietly(() => store.clear());
    return;
  }
  try {
    await send(payload);
  } catch {
    return; // unreachable: try again next launch
  }
  quietly(() => store.clear());
}

/** React Native's global handler for anything thrown that nothing caught. */
export type GlobalHandler = (error: unknown, isFatal?: boolean) => void;

interface HandlerHost {
  getGlobalHandler: () => GlobalHandler;
  setGlobalHandler: (handler: GlobalHandler) => void;
}

const INSTALLED = Symbol.for("lumiback.errorReporting");

/**
 * Reports uncaught errors, then hands each one to the handler that was there before (the red
 * box in development, the crash in a release build), so nothing about how the app fails
 * changes. Installing twice (a fast refresh) keeps one reporter.
 */
export function installHandler(
  host: HandlerHost | undefined,
  report: (error: unknown, fatal?: boolean) => void,
): void {
  if (!host) return;
  const previous = host.getGlobalHandler();
  if ((previous as { [INSTALLED]?: boolean })[INSTALLED]) return;
  const handler: GlobalHandler = (error, isFatal) => {
    try {
      report(error, isFatal);
    } catch {
      // A reporter must never be the next error.
    }
    previous(error, isFatal);
  };
  (handler as { [INSTALLED]?: boolean })[INSTALLED] = true;
  host.setGlobalHandler(handler);
}

/** The part of Hermes' `HermesInternal` used here (a JS API of the engine: no native module). */
export interface HermesLike {
  enablePromiseRejectionTracker?: (options: {
    allRejections: boolean;
    onUnhandled: (id: number, rejection: unknown) => void;
    onHandled: (id: number) => void;
  }) => void;
}

/**
 * Reports promise rejections nothing handled (an `await` without a try, a `.then` without a
 * catch): React Native's global handler never sees them. Only in a release build: in
 * development React Native already tracks them (its yellow box), and only one tracker can
 * be on. Hermes alone has the hook; without it, nothing happens.
 */
export function trackRejections(
  hermes: HermesLike | undefined,
  dev: boolean,
  report: (error: unknown) => void,
): void {
  if (dev || typeof hermes?.enablePromiseRejectionTracker !== "function") return;
  hermes.enablePromiseRejectionTracker({
    allRejections: true,
    onUnhandled: (_id, rejection) => {
      try {
        report(rejection);
      } catch {
        // A reporter must never be the next error.
      }
    },
    onHandled: () => undefined,
  });
}
