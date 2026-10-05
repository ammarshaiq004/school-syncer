"use client";

import { useEffect, useRef } from "react";

const visible = () => typeof document === "undefined" || document.visibilityState === "visible";

/**
 * Runs `callback` every `ms` while the tab is visible, and once right away when the tab becomes
 * visible again (so a returning user sees fresh data without waiting for the next tick).
 * Pass `ms = null` to pause.
 */
export function useVisibleInterval(callback: () => void, ms: number | null) {
  const saved = useRef(callback);
  useEffect(() => {
    saved.current = callback;
  }, [callback]);

  useEffect(() => {
    if (ms == null) return;
    const tick = () => {
      if (visible()) saved.current();
    };
    const id = setInterval(tick, ms);
    const onVisibility = () => {
      if (visible()) saved.current();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ms]);
}
