"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Small localStorage-backed state shared by every component using the same key.
 * Reads are safe on the server (returns the fallback) and in private mode.
 */
const listeners = new Map<string, Set<() => void>>();
const cache = new Map<string, string | null>();

function read(key: string): string | null {
  if (cache.has(key)) return cache.get(key)!;
  let value: string | null = null;
  try {
    value = localStorage.getItem(key);
  } catch {
    value = null;
  }
  cache.set(key, value);
  return value;
}

export function writePersisted(key: string, value: string | null) {
  cache.set(key, value);
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage unavailable; the value lives until reload.
  }
  listeners.get(key)?.forEach((l) => l());
}

function subscribe(key: string, listener: () => void) {
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(listener);
  return () => set.delete(listener);
}

/** [value, setValue] persisted under `key` as JSON. */
export function usePersistedState<T>(key: string, fallback: T): [T, (next: T) => void] {
  const raw = useSyncExternalStore(
    useCallback((l: () => void) => subscribe(key, l), [key]),
    () => read(key),
    () => null,
  );
  let value = fallback;
  if (raw !== null) {
    try {
      value = JSON.parse(raw) as T;
    } catch {
      value = fallback;
    }
  }
  const set = useCallback((next: T) => writePersisted(key, JSON.stringify(next)), [key]);
  return [value, set];
}
