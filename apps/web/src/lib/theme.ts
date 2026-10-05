"use client";

import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
import { THEME_KEY } from "./theme-script";

const listeners = new Set<() => void>();

function current(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function setTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // ignore
  }
  listeners.forEach((l) => l());
}

/** The active theme ("light" during server render) and a setter. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    current,
    () => "light" as Theme,
  );
  return [theme, setTheme];
}
