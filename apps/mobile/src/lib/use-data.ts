import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "@/lib/api";

interface DataState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  /** Pull-to-refresh, or after an action changed the data (shows the refresh spinner). */
  reload: () => Promise<void>;
  /** Background polling: same fetch, no spinner. */
  refetch: () => Promise<void>;
}

/** Loads when the screen comes into focus (so tabs stay fresh) and on demand. */
export function useData<T>(load: () => Promise<T>): DataState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const loader = useRef(load);
  useEffect(() => {
    loader.current = load;
  }, [load]);
  // Only the newest call may write: switching sections or filters quickly must not let a slower,
  // older reply overwrite the current one.
  const latest = useRef(0);

  const run = useCallback(async (pull: boolean) => {
    const call = ++latest.current;
    if (pull) setRefreshing(true);
    try {
      const next = await loader.current();
      if (call !== latest.current) return;
      setData(next);
      setError(null);
    } catch (e) {
      if (call !== latest.current) return;
      setError(e instanceof ApiError ? e.detail : "Something went wrong. Try again.");
    } finally {
      if (call === latest.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void run(false);
    }, [run]),
  );

  const reload = useCallback(() => run(true), [run]);
  const refetch = useCallback(() => run(false), [run]);
  return { data, error, loading, refreshing, reload, refetch };
}
