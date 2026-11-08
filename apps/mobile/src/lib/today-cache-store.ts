/** Today offline's storage (the rules are in today-cache.ts). */
import * as SecureStore from "expo-secure-store";

import { sessionGeneration } from "@/lib/session";
import {
  MAX_CACHE_LENGTH,
  parseTodayCache,
  serializeTodayCache,
  type TodayCache,
} from "@/lib/today-cache";

const KEY = "lumiback.today-offline";

/**
 * Keeps Today's trip for offline use. Skipped when the session changed since the load began
 * (`session`, read before it), so a sign-out or another sign-in mid-load never keeps the
 * previous student's trip. Best effort: storage errors are ignored.
 */
export async function saveTodayCache(cache: TodayCache, session: number): Promise<void> {
  if (sessionGeneration() !== session) return;
  const raw = serializeTodayCache(cache);
  if (raw.length > MAX_CACHE_LENGTH) return;
  await SecureStore.setItemAsync(KEY, raw).catch(() => undefined);
  // A sign-out or sign-in that cleared the store while this write was in flight: undo it.
  if (sessionGeneration() !== session) await clearTodayCache();
}

export async function loadTodayCache(): Promise<TodayCache | null> {
  try {
    return parseTodayCache(await SecureStore.getItemAsync(KEY));
  } catch {
    return null;
  }
}

/** Forgets the kept trip (every sign-in and sign-out). */
export async function clearTodayCache(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY).catch(() => undefined);
}
