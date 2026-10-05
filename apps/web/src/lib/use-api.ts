"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, platformApi } from "./api";

/** Loads a GET endpoint (skipped when path is null) and exposes reload() for after a change. */
export function useApi<T>(path: string | null, fetcher: <R>(path: string) => Promise<R> = api) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  /** HTTP status of the last failure (e.g. 409), or null. */
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const fail = useCallback((e: unknown) => {
    setError((e as Error).message);
    setErrorStatus(e instanceof ApiError ? e.status : null);
  }, []);

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      setData(await fetcher<T>(path));
      setError("");
      setErrorStatus(null);
    } catch (e) {
      fail(e);
    }
  }, [path, fetcher, fail]);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    fetcher<T>(path).then(
      (result) => !cancelled && (setData(result), setError(""), setErrorStatus(null)),
      (e: unknown) => !cancelled && fail(e),
    );
    return () => {
      cancelled = true;
    };
  }, [path, fetcher, fail]);

  return { data, error, errorStatus, reload };
}

/** useApi for the SchoolSyncer console's /platform endpoints. */
export const usePlatformApi = <T>(path: string | null) => useApi<T>(path, platformApi);
