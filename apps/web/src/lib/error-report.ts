/**
 * Reporting what broke to Lumiback's own API (POST /errors, through /api/errors). The API
 * scrubs every report before storing it; this side only keeps reports few and safe to send:
 * - the page's path only, never its query string or fragment (nor a gate's code);
 * - a body that always fits the API's byte cap (the stack's end is cut to fit);
 * - each error once per page load (by its message and first stack frame), and at most a few;
 * - one failed send turns reporting off for the rest of the page load, so a broken /errors
 *   can never cause a loop of reports about itself;
 * - nothing here throws or logs: a reporter that fails must stay silent.
 * Pure (no Next.js or browser imports) so it runs under `node --test`.
 */

export const LIMITS = { message: 500, stack: 8000, route: 300 } as const;
/**
 * The most a report's JSON may take, in UTF-8 bytes. The API refuses a body over 16 KB
 * (backend app/api/errors.py MAX_BODY_BYTES) and the fields' caps are in characters: 8000
 * characters of Devanagari are 24 000 bytes. Under the cap with room for what /api/errors
 * adds (the platform and the build's version).
 */
export const MAX_BODY_BYTES = 15 * 1024;
const MAX_PER_RUN = 5;

export interface ErrorPayload {
  message: string;
  stack: string | null;
  route: string | null;
  /** Left out by the website: /api/errors adds its own build's version. */
  app_version?: string;
  platform: "web" | "android" | "ios";
}

/** Browser noise that says nothing about Lumiback's code. */
const NOISE = [/^ResizeObserver loop/];

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
 * The path alone: a query string or fragment can carry a code or a token. A gate's page
 * (/g/<code>) carries the gate's rotating code in the path itself, so it is never sent.
 */
export function pathOnly(route: string): string {
  const path = route.split(/[?#]/, 1)[0]!;
  return (/^\/g\/./.test(path) ? "/g/[code]" : path).slice(0, LIMITS.route);
}

/**
 * A Next.js server error's digest, as a tag for its message. In production every server
 * error reaches the browser with the same message (the real one stays on the server), so
 * without it they would all be one group. Digits are written as letters (a=0 ... j=9): the API
 * leaves digits out of a group's key and scrubs long numbers.
 */
function digestTag(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  let digest: unknown;
  try {
    digest = (error as { digest?: unknown }).digest;
  } catch {
    return ""; // a getter that throws
  }
  if (typeof digest !== "string") return "";
  const letters = digest
    .replace(/[0-9]/g, (d) => String.fromCharCode(97 + Number(d)))
    .replace(/[^A-Za-z_-]/g, "")
    .slice(0, 40);
  return letters ? ` [digest ${letters}, a=0]` : "";
}

/** The first `end` UTF-16 units, one fewer if that would split a two-unit character. */
function cut(text: string, end: number): string {
  if (text.length <= end) return text;
  const last = text.charCodeAt(end - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? end - 1 : end);
}

/** How many bytes `text` takes in UTF-8. */
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

function noise(message: string, stack: string | null): boolean {
  // A cross-origin script's error: the browser hides everything, so there's nothing to fix.
  if (/^(Error: )?Script error\.?$/.test(message) && !stack) return true;
  return NOISE.some((pattern) => pattern.test(message.replace(/^Error: /, "")));
}

interface ReporterOptions {
  platform: ErrorPayload["platform"];
  version?: string;
  /** The current page's path (or route), read when an error is reported. */
  route: () => string | null;
  /** Resolves true when the report was taken. */
  send: (payload: ErrorPayload) => Promise<boolean>;
  max?: number;
}

export function createReporter(options: ReporterOptions): { report: (error: unknown) => void } {
  const seen = new Set<string>();
  let off = false;
  const max = options.max ?? MAX_PER_RUN;

  function stop(): void {
    off = true;
  }

  return {
    report(error: unknown): void {
      if (off || seen.size >= max) return;
      const described = describeError(error);
      if (!described) return;
      const { stack } = described;
      if (noise(described.message, stack)) return;
      const tag = digestTag(error);
      const message = cut(described.message, LIMITS.message - tag.length) + tag;
      const key = `${message}\n${firstFrame(stack)}`;
      if (seen.has(key)) return;
      seen.add(key);
      try {
        const route = options.route();
        const payload: ErrorPayload = {
          message,
          stack: stack ? cut(stack, LIMITS.stack) : null,
          route: route ? pathOnly(route) : null,
          platform: options.platform,
        };
        if (options.version) payload.app_version = options.version;
        options.send(fit(payload)).then((ok) => {
          if (!ok) stop();
        }, stop);
      } catch {
        stop();
      }
    },
  };
}
