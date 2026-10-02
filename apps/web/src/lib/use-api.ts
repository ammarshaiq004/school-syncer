"use client";

import { useCallback, useEffect, useState } from "react";
import { api, platformApi } from "./api";

/** Loads a GET endpoint (skipped when path is null) and exposes reload() for after a change. */
export function useApi<T>(path: string | null, fetcher: <R>(path: string) => Promise<R> = api) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      setData(await fetcher<T>(path));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [path, fetcher]);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    fetcher<T>(path).then(
      (result) => !cancelled && (setData(result), setError("")),
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [path, fetcher]);

  return { data, error, reload };
}

/** useApi for the SchoolSyncer console's /platform endpoints. */
export const usePlatformApi = <T>(path: string | null) => useApi<T>(path, platformApi);
