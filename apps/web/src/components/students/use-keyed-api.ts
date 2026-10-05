"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

/**
 * Like useApi, but data and error belong to the path they were loaded for:
 * after the path changes they read as null/"" until the new response arrives,
 * so a panel never shows the previous record under a new heading.
 * `loading` is true while the current path has neither data nor error.
 */
export function useKeyedApi<T>(path: string | null) {
  const [state, setState] = useState<{ path: string | null; data: T | null; error: string }>({ path: null, data: null, error: "" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    api<T>(path).then(
      (data) => !cancelled && setState({ path, data, error: "" }),
      (e: unknown) => !cancelled && setState((s) => ({ path, data: s.path === path ? s.data : null, error: (e as Error).message })),
    );
    return () => {
      cancelled = true;
    };
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const current = state.path === path && path !== null;
  const data = current ? state.data : null;
  const error = current ? state.error : "";
  return { data, error, loading: path !== null && !data && !error, reload };
}
