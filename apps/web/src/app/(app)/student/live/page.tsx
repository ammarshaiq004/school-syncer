"use client";

import { useState } from "react";
import { CalendarClock, CircleCheck, CirclePlay, History, Video } from "lucide-react";
import { SCHOOL_TZ } from "@/components/elearning/live-types";
import { clockTime, LiveClassCard, LiveNowBadge, shortDay, useNow, type LiveCardData } from "@/components/student/live-widgets";
import type { LiveState } from "@/components/student/types";
import type { LiveStatus, StudentLiveData, StudentLiveItem } from "@/components/student-learning/types";
import {
  Badge,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorState,
  KpiCard,
  PageHeader,
  SkeletonRows,
  StatGrid,
  TabPanel,
  Tabs,
  type Column,
} from "@/components/ui";
import { useApi } from "@/lib/use-api";

const STATE: Record<LiveStatus, LiveState> = { LIVE: "live", SCHEDULED: "upcoming", ENDED: "ended", CANCELLED: "cancelled" };

const toCard = (l: StudentLiveItem): LiveCardData => ({
  id: l.id,
  title: l.title,
  subject: l.subject?.name ?? null,
  teacher: l.teacher?.name ?? null,
  startsAt: l.startsAt,
  endsAt: l.endsAt,
  durationMin: l.durationMin,
  provider: l.provider,
  state: STATE[l.status],
  recordingUrl: l.recordingUrl,
  joined: l.attended,
});

const dayKey = (iso: string | Date) => new Date(iso).toLocaleDateString("en-CA", { timeZone: SCHOOL_TZ });

function dayLabel(iso: string) {
  const today = new Date();
  const key = dayKey(iso);
  if (key === dayKey(today)) return "Today";
  if (key === dayKey(new Date(today.getTime() + 24 * 3600_000))) return "Tomorrow";
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: SCHOOL_TZ });
}

/** Student live classes: Live now, upcoming grouped by day with countdowns, and past classes with recordings. */
export default function StudentLivePage() {
  const { data, error, reload } = useApi<StudentLiveData>("/student/live");
  const now = useNow(60_000);
  const [tab, setTab] = useState("upcoming");

  const groups: { key: string; label: string; items: StudentLiveItem[] }[] = [];
  for (const l of data?.upcoming ?? []) {
    const key = dayKey(l.startsAt);
    const g = groups.find((x) => x.key === key);
    if (g) g.items.push(l);
    else groups.push({ key, label: dayLabel(l.startsAt), items: [l] });
  }
  const recent = data?.recent ?? [];
  const attended = recent.filter((r) => r.attended).length;
  const weekAhead = (now ?? 0) + 7 * 86_400_000;
  const thisWeek = now === null ? undefined : data?.upcoming.filter((u) => u.status === "SCHEDULED" && new Date(u.startsAt).getTime() < weekAhead).length;

  const columns: Column<StudentLiveItem>[] = [
    {
      id: "class",
      header: "Class",
      sortValue: (r) => r.title,
      cell: (r) => (
        <span className="block min-w-0">
          <span className="block truncate font-medium text-fg">{r.title}</span>
          <span className="block truncate text-xs text-fg-muted">{[r.subject?.name, r.teacher?.name].filter(Boolean).join(", ")}</span>
        </span>
      ),
    },
    {
      id: "when",
      header: "Held on",
      sortValue: (r) => r.startsAt,
      cell: (r) => (
        <span className="tabular-nums text-fg-secondary">
          {shortDay(r.startsAt)}, {clockTime(r.startsAt)}
        </span>
      ),
      hideBelow: "sm",
    },
    {
      id: "attended",
      header: "You",
      sortValue: (r) => Number(r.attended),
      cell: (r) => (r.attended ? <Badge tone="success" icon={<CircleCheck />}>Joined</Badge> : <Badge tone="neutral">Missed</Badge>),
    },
    {
      id: "recording",
      header: "Recording",
      align: "right",
      cell: (r) =>
        r.recordingUrl ? (
          <a
            href={r.recordingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand hover:underline"
            aria-label={`Watch the recording of ${r.title}`}
          >
            <CirclePlay className="size-4" aria-hidden />
            Watch
          </a>
        ) : (
          <span className="text-[13px] text-fg-muted">Not shared</span>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Live classes"
        description="Join online classes from 15 minutes before they start. Recordings appear once a class ends."
        breadcrumbs={[{ label: "Student Workspace", href: "/student" }, { label: "Live classes" }]}
      />

      {error && !data ? (
        <Card padding="none">
          <ErrorState message={error} onRetry={reload} />
        </Card>
      ) : (
        <>
          <StatGrid cols={3}>
            <KpiCard label="Live right now" value={data ? data.liveNow.length : ""} loading={!data} icon={<Video />} tone={data?.liveNow.length ? "danger" : "neutral"} hint={data?.liveNow.length ? "Join from the card below" : "Nothing live at the moment"} />
            <KpiCard label="Coming up this week" value={thisWeek ?? ""} loading={!data} icon={<CalendarClock />} tone="info" />
            <KpiCard
              label="Attended, last 30 days"
              value={recent.length ? `${Math.round((attended / recent.length) * 100)}%` : "No classes"}
              loading={!data}
              icon={<CircleCheck />}
              tone={!recent.length ? "neutral" : attended / recent.length >= 0.8 ? "success" : "warning"}
              hint={recent.length ? `${attended} of ${recent.length} classes joined` : undefined}
            />
          </StatGrid>

          {data && data.liveNow.length > 0 && (
            <Card className="border-danger/40">
              <CardHeader icon={<Video />} title="Live now" action={<LiveNowBadge />} />
              <div className="flex flex-col gap-3">
                {data.liveNow.map((l) => (
                  <LiveClassCard key={l.id} live={toCard(l)} onJoined={reload} />
                ))}
              </div>
            </Card>
          )}

          {/* Two tabs so recordings are one tap away instead of a whole week's scroll below the upcoming cards. */}
          <Tabs
            tabs={[
              { value: "upcoming", label: "Upcoming", icon: <CalendarClock />, count: data?.upcoming.length },
              { value: "past", label: "Past and recordings", icon: <History />, count: data ? recent.length : undefined },
            ]}
            value={tab}
            onValueChange={setTab}
            aria-label="Live classes"
          >
            <TabPanel value="upcoming">
              <Card>
                <CardHeader icon={<CalendarClock />} title="Upcoming" description="Times are shown in Pakistan time." />
                {!data ? (
                  <SkeletonRows rows={3} columns={2} />
                ) : groups.length === 0 ? (
                  <EmptyState icon={<CalendarClock />} title="No upcoming live classes" description="When your teachers schedule a class, it shows here with a countdown." compact />
                ) : (
                  <div className="flex flex-col gap-5">
                    {groups.map((g) => (
                      <section key={g.key} aria-label={g.label} className="flex flex-col gap-2.5">
                        <h3 className="text-[13px] font-semibold text-fg-secondary">{g.label}</h3>
                        {g.items.map((l) => (
                          <LiveClassCard key={l.id} live={toCard(l)} onJoined={reload} />
                        ))}
                      </section>
                    ))}
                  </div>
                )}
              </Card>
            </TabPanel>

            <TabPanel value="past">
              <DataTable
                label="Past live classes"
                columns={columns}
                data={data?.recent ?? null}
                getRowId={(r) => r.id}
                defaultSort={{ id: "when", dir: "desc" }}
                getSearchText={(r) => `${r.title} ${r.subject?.name ?? ""} ${r.teacher?.name ?? ""}`}
                searchPlaceholder="Search class or subject"
                pageSize={10}
                empty={{ title: "No past classes yet", description: "Classes from the last 30 days appear here with their recordings." }}
              />
            </TabPanel>
          </Tabs>
        </>
      )}
    </div>
  );
}
