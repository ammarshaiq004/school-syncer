"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

/** Loads a GET endpoint and exposes reload() for after a change. */
export function useApi<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(
    () =>
      api<T>(path).then(
        (result) => {
          setData(result);
          setError("");
        },
        (e: Error) => setError(e.message),
      ),
    [path],
  );

  useEffect(() => {
    let cancelled = false;
    api<T>(path).then(
      (result) => !cancelled && setData(result),
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [path]);

  return { data, error, reload: load };
}
