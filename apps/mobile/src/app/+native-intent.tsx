import { safeIncomingPath } from "@/lib/incoming-link";

/**
 * Every link that opens the app passes through here before Expo Router parses it.
 * Docs: https://docs.expo.dev/router/advanced/native-intent/
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return safeIncomingPath(path);
}
