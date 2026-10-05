"use client";

import { useEffect, useState } from "react";
import { StatusPill } from "@/components/ui";
import type { LiveStatus } from "./live-types";

/** "Live now" with a pulsing dot; other states as plain status pills. */
export function LiveStatusPill({ status }: { status: LiveStatus }) {
  if (status !== "LIVE") return <StatusPill status={status} tone={status === "ENDED" ? "neutral" : undefined} />;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-danger-tint px-2 py-0.5 text-xs font-medium text-danger-text">
      <span className="relative flex size-2" aria-hidden>
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-danger opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-danger" />
      </span>
      Live now
    </span>
  );
}

/** Current time, refreshed every 30 seconds (for countdowns). */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
