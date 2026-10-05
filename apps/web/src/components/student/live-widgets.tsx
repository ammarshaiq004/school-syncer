"use client";

import { useEffect, useState } from "react";
import { CirclePlay, Clock, Video } from "lucide-react";
import { Badge, Button, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { SCHOOL_TZ } from "@/components/elearning/live-types";
import type { LiveProvider, LiveState } from "./types";

/** The current time, refreshed every `ms` (default 1 s) for countdowns. Null until mounted (no SSR mismatch). */
export function useNow(ms = 1000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

/** "10:30 am" in school time (Asia/Karachi). */
export const clockTime = (iso: string | Date) =>
  new Date(iso).toLocaleTimeString("en-PK", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: SCHOOL_TZ }).toLowerCase();

/** "Mon 12 Oct" in school time. */
export const shortDay = (iso: string | Date) =>
  new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: SCHOOL_TZ });

/** "08:00" (a timetable HH:MM) as "8:00 am". */
export function periodTime(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** "2 h 05 min", "4 min 12 s", "38 s" until a moment. */
export function countdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d} day${d === 1 ? "" : "s"}`;
  }
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} min`;
  if (m > 0) return `${m} min ${String(s).padStart(2, "0")} s`;
  return `${s} s`;
}

/** "Wed 8:00 am" in school time: the weekday and start time of a class days away. */
export const weekdayTime = (iso: string | Date) =>
  `${new Date(iso).toLocaleDateString("en-GB", { weekday: "short", timeZone: SCHOOL_TZ })} ${clockTime(iso)}`;

/**
 * How an upcoming class's start reads. A countdown is only useful within a day;
 * past that it flattens to "1 day" for anything from 24 to 48 hours away, so the
 * weekday and time are shown instead ("Starts Wed 8:00 am").
 */
export function startsText(startsAt: string | Date, now: number) {
  const ms = new Date(startsAt).getTime() - now;
  return ms >= 86_400_000
    ? { prefix: "Starts", value: weekdayTime(startsAt) }
    : { prefix: "Starts in", value: countdown(ms) };
}

export const PROVIDER_LABEL: Record<LiveProvider, string> = {
  JITSI: "Jitsi Meet",
  ZOOM: "Zoom",
  GOOGLE_MEET: "Google Meet",
  OTHER: "Online meeting",
};

/** Red "Live now" badge with a soft pulse (still when reduced motion is on). */
export function LiveNowBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-danger-tint px-2.5 py-0.5 text-xs font-semibold text-danger-text",
        className,
      )}
    >
      <span className="relative flex size-2" aria-hidden>
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-danger opacity-75 motion-reduce:animate-none" />
        <span className="relative inline-flex size-2 rounded-full bg-danger" />
      </span>
      Live now
    </span>
  );
}

/**
 * Joins a live class: records attendance (POST /student/live/:id/join) and opens the meeting in a new tab.
 * The tab is opened before the request so pop-up blockers allow it.
 */
export function useJoinLive(onJoined?: () => void) {
  const toast = useToast();
  const [joining, setJoining] = useState<string | null>(null);

  async function join(id: string, title: string) {
    setJoining(id);
    const tab = window.open("", "_blank");
    try {
      const res = await api<{ joinUrl: string }>(`/student/live/${id}/join`, { method: "POST" });
      if (tab) {
        tab.opener = null;
        tab.location.href = res.joinUrl;
      } else {
        window.location.href = res.joinUrl;
      }
      toast.success("Joining class", title);
      onJoined?.();
    } catch (e) {
      tab?.close();
      toast.error("Could not join the class", (e as Error).message);
    } finally {
      setJoining(null);
    }
  }

  return { join, joining };
}

export interface LiveCardData {
  id: string;
  title: string;
  subject: string | null;
  teacher: string | null;
  startsAt: string;
  endsAt: string;
  durationMin: number;
  provider: LiveProvider;
  state: LiveState;
  recordingUrl?: string | null;
  joined?: boolean;
}

const JOIN_EARLY_MS = 15 * 60_000;

/**
 * A live class as a feature card: Live now pulse, countdown while upcoming, Join button
 * (enabled from 15 minutes before the start), recording link once ended.
 */
export function LiveClassCard({ live, onJoined, compact }: { live: LiveCardData; onJoined?: () => void; compact?: boolean }) {
  const now = useNow();
  const { join, joining } = useJoinLive(onJoined);
  const start = new Date(live.startsAt).getTime();
  const end = new Date(live.endsAt).getTime();
  // The API state is a snapshot; move it along as the clock runs.
  let state = live.state;
  if (now !== null && state === "upcoming" && now >= start) state = now > end ? "ended" : "live";
  if (now !== null && state === "live" && now > end) state = "ended";
  const canJoin = state === "live" || (state === "upcoming" && now !== null && now >= start - JOIN_EARLY_MS);
  const who = [live.subject, live.teacher].filter(Boolean).join(" with ");
  const starts = state === "upcoming" && now !== null ? startsText(live.startsAt, now) : null;

  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center",
        state === "live" ? "border-danger/40 bg-danger-tint/40" : "border-border bg-surface",
        compact && "p-3",
      )}
    >
      <span
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-lg",
          state === "live" ? "bg-danger text-primary-fg" : "bg-primary-tint text-brand",
        )}
        aria-hidden
      >
        <Video className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {state === "live" && <LiveNowBadge />}
          {state === "cancelled" && <Badge tone="neutral">Cancelled</Badge>}
          {state === "ended" && <Badge tone="neutral">Ended</Badge>}
          {live.joined && <Badge tone="success">Joined</Badge>}
        </div>
        <p className="mt-1 truncate font-display text-base font-semibold text-fg">{live.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-fg-muted">
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Clock className="size-3.5" aria-hidden />
            {clockTime(live.startsAt)} to {clockTime(live.endsAt)}
          </span>
          {who && <span>{who}</span>}
          <span>{PROVIDER_LABEL[live.provider]}</span>
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-stretch gap-1.5 sm:items-end">
        {starts && (
          <p className="text-[13px] tabular-nums text-fg-secondary" aria-live="off">
            {starts.prefix} <span className="font-semibold text-fg">{starts.value}</span>
          </p>
        )}
        {(state === "live" || state === "upcoming") && (
          <Button
            type="button"
            size="sm"
            variant={state === "live" ? "danger" : "primary"}
            icon={<Video />}
            disabled={!canJoin}
            loading={joining === live.id}
            onClick={() => join(live.id, live.title)}
            aria-label={`Join ${live.title}`}
            title={canJoin ? undefined : "You can join from 15 minutes before the class starts"}
          >
            {state === "live" ? "Join now" : "Join"}
          </Button>
        )}
        {state === "ended" && live.recordingUrl && (
          <a
            href={live.recordingUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand hover:underline"
          >
            <CirclePlay className="size-4" aria-hidden />
            Watch recording
          </a>
        )}
      </div>
    </div>
  );
}
