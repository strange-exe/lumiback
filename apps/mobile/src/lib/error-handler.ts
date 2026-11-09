import { File, Paths } from "expo-file-system";
import { Platform } from "react-native";

import { API_URL } from "@/lib/config";
import {
  createReporter,
  installHandler,
  sendPending,
  trackRejections,
  type ErrorPayload,
  type GlobalHandler,
  type HermesLike,
  type PendingStore,
} from "@/lib/error-report";
import { currentAccessToken } from "@/lib/session";
import { CURRENT } from "@/updates/changelog";

/**
 * The app's error reporting: anything thrown that nothing caught (and promise rejections nothing
 * handled, in a release build) goes to POST /errors (the API scrubs it before storing it), then
 * on to React Native's own handler as before. A crash's report is saved to a file first and sent
 * on the next launch, since the app is usually gone before its request leaves. Plain fetch and
 * expo-file-system (already in the build): no new native module. The signed-in id is attached
 * only through a token already in memory: the reporter never refreshes or touches the session.
 */

let route: string | null = null;

/** The current screen's path, kept by the root layout for the next report. */
export function setErrorRoute(pathname: string | null): void {
  route = pathname;
}

const platform = Platform.OS === "ios" ? "ios" : "android";

async function send(payload: ErrorPayload): Promise<boolean> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = currentAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_URL}/errors`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  return response.ok;
}

/**
 * One file in the app's own documents folder (not the cache, which the system may clear).
 * Synchronous reads and writes (expo-file-system 57's File.write and textSync): the fatal
 * handler saves before React Native ends the app. Holds the report as sent, before the API's
 * scrub, inside the app's private storage, and only until the next launch sends it.
 */
function crashFile(): File {
  return new File(Paths.document, "lumiback-crash-report.json");
}

const pending: PendingStore = {
  read: () => {
    const file = crashFile();
    return file.exists ? file.textSync() : null;
  },
  write: (raw) => {
    const file = crashFile();
    if (!file.exists) file.create();
    file.write(raw);
  },
  clear: () => {
    const file = crashFile();
    if (file.exists) file.delete();
  },
};

const reporter = createReporter({
  platform,
  version: CURRENT.version,
  route: () => route,
  send,
  pending,
});

/** Reports an error that was caught and shown (the root error boundary). Never throws. */
export function reportCaughtError(error: unknown): void {
  try {
    reporter.report(error);
  } catch {
    // A reporter must never be the next error.
  }
}

interface ErrorUtilsLike {
  getGlobalHandler: () => GlobalHandler;
  setGlobalHandler: (handler: GlobalHandler) => void;
}

/** Called once at start-up (app/_layout.tsx, at module scope). Safe to call again. */
export function installErrorReporting(): void {
  if (Platform.OS !== "android" && Platform.OS !== "ios") return;
  try {
    const host = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
    installHandler(host, (error, fatal) => reporter.report(error, fatal));
    const hermes = (globalThis as { HermesInternal?: HermesLike }).HermesInternal;
    trackRejections(hermes, __DEV__, (error) => reporter.report(error));
    // Last launch's crash, if it left a report behind.
    void sendPending(pending, send);
  } catch {
    // Reporting is a nice to have: never let it stop the app.
  }
}
