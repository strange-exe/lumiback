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

  const run = useCallback(async (pull: boolean) => {
    if (pull) setRefreshing(true);
    try {
      setData(await loader.current());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : "Something went wrong. Try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
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
