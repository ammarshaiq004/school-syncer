"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { IconButton } from "./button";
import { Tooltip } from "./overlay";

/** Light/dark switch (persisted, no flash). */
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useTheme();
  const dark = theme === "dark";
  const label = dark ? "Switch to light theme" : "Switch to dark theme";
  return (
    <Tooltip content={label} side="bottom">
      <IconButton aria-label={label} onClick={() => setTheme(dark ? "light" : "dark")} className={className}>
        <span key={theme} className="animate-pop-in">
          {dark ? <Sun /> : <Moon />}
        </span>
      </IconButton>
    </Tooltip>
  );
}
