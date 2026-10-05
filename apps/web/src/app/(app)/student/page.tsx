"use client";

import Link from "next/link";
import { ArrowRight, CalendarClock, ClipboardList, Coffee, ListChecks, Megaphone, NotebookPen, Timer, Video } from "lucide-react";
import { ASSIGNMENT_STATE, dueText, greeting, schoolMinutes } from "@/components/student/format";
import { LiveClassCard, periodTime, useNow } from "@/components/student/live-widgets";
import { NoticeList } from "@/components/student/notice-list";
import type { StudentToday, TodayPeriod } from "@/components/student/types";
import { Badge, Card, CardHeader, EmptyState, ErrorState, Skeleton, SkeletonRows, StatusPill } from "@/components/ui";
import { cn } from "@/lib/cn";
import { roomLabel } from "@/lib/format";
import { useSchoolMode, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

function SeeAll({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
      {children}
      <ArrowRight className="size-3.5" aria-hidden />
    </Link>
  );
}

export default function StudentTodayPage() {
  const user = useSession();
  const mode = useSchoolMode();
  const today = useApi<StudentToday>("/student/today");
  const now = useNow(30_000);
  const features = user.plan?.features;
  const eschool = mode !== "PHYSICAL" && (!features || features.includes("elearning"));
  const t = today.data;

  if (today.error && !t) {
    return <ErrorState title="Could not load your day" message={today.error} onRetry={today.reload} />;
  }

  const firstName = t?.student.firstName ?? user.name.split(" ")[0];
  const dateLabel = t
    ? new Date(`${t.date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })
    : null;
  const lessons = t?.timetable.filter((p) => !p.isBreak).length ?? 0;
  const liveSorted = t ? [...t.liveClasses].sort((a, b) => rank(a.state) - rank(b.state) || a.startsAt.localeCompare(b.startsAt)) : [];
  const nowMinutes = now === null ? null : schoolMinutes(now);

  return (
    <div className="flex flex-col gap-6">
      {/* Greeting hero */}
      <Card padding="lg" className="animate-rise">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-brand">{dateLabel ?? <Skeleton className="h-4 w-40" />}</div>
            <h1 className="mt-1 text-xl font-semibold text-fg sm:text-2xl">
              {greeting(now === null ? undefined : new Date(now))}, {firstName}
            </h1>
            <p className="mt-1 text-sm text-fg-muted">
              {t?.section ? `${t.section.name}. Here is what your day looks like.` : t ? "You are not placed in a class yet. Ask the school office." : "Loading your day"}
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-3 sm:min-w-[22rem]">
            <HeroStat icon={<CalendarClock />} label="Lessons today" value={t ? lessons : null} />
            {eschool ? (
              <>
                <HeroStat icon={<NotebookPen />} label="Due this week" value={t ? t.assignmentsDue.filter((a) => a.status === "pending" || a.status === "returned").length : null} />
                <HeroStat icon={<ListChecks />} label="Open quizzes" value={t ? t.quizzesOpen.length : null} />
              </>
            ) : (
              <HeroStat icon={<Megaphone />} label="Recent notices" value={t ? t.announcements.length : null} />
            )}
          </dl>
        </div>
      </Card>

      {/* Live classes today */}
      {eschool && (
        <Card>
          <CardHeader
            icon={<Video />}
            title="Live classes today"
            description="Join from 15 minutes before the start."
            action={<SeeAll href="/student/live">All live classes</SeeAll>}
          />
          {!t ? (
            <Skeleton className="h-20 w-full rounded-xl" />
          ) : liveSorted.length === 0 ? (
            <EmptyState icon={<Video />} title="No live classes today" description="When your teachers schedule one, it shows here with a Join button." compact />
          ) : (
            <div className="flex flex-col gap-3">
              {liveSorted.map((l) => (
                <LiveClassCard key={l.id} live={l} onJoined={today.reload} compact={l.state === "ended"} />
              ))}
            </div>
          )}
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Timetable */}
        <Card className="lg:col-span-2">
          <CardHeader icon={<CalendarClock />} title="Today's timetable" description={t?.section ? t.section.name : undefined} />
          {!t ? (
            <SkeletonRows rows={6} columns={3} />
          ) : t.timetable.length === 0 ? (
            <EmptyState icon={<Coffee />} title="No lessons on the timetable today" description="Enjoy the day off, or check your courses to catch up." compact />
          ) : (
            <ol className="flex flex-col gap-1.5" aria-label="Periods today">
              {t.timetable.map((p) => (
                <PeriodRow key={p.periodId} period={p} nowMinutes={nowMinutes} />
              ))}
            </ol>
          )}
        </Card>

        <div className="flex flex-col gap-6">
          {eschool && (
            <Card>
              <CardHeader icon={<ClipboardList />} title="Due this week" action={<SeeAll href="/student/assignments">Assignments</SeeAll>} />
              {!t ? (
                <SkeletonRows rows={3} columns={1} />
              ) : t.assignmentsDue.length === 0 ? (
                <EmptyState icon={<ClipboardList />} title="Nothing due this week" description="New assignments from your teachers appear here." compact />
              ) : (
                <ul className="-my-2 flex flex-col divide-y divide-border">
                  {t.assignmentsDue.map((a) => {
                    const st = ASSIGNMENT_STATE[a.status];
                    const urgent = a.hoursLeft < 24 && (a.status === "pending" || a.status === "returned");
                    return (
                      <li key={a.id}>
                        <Link href={`/student/assignments/${a.id}`} className="-mx-2 flex items-start justify-between gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-2">
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-fg">{a.title}</span>
                            <span className={cn("block text-[13px]", urgent ? "font-medium text-danger-text" : "text-fg-muted")}>
                              {a.subject}. {dueText(a.dueAt)}
                            </span>
                          </span>
                          <StatusPill status={a.status} label={st.label} tone={st.tone} />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          )}

          {eschool && (
            <Card>
              <CardHeader icon={<ListChecks />} title="Open quizzes" action={<SeeAll href="/student/quizzes">Quizzes</SeeAll>} />
              {!t ? (
                <SkeletonRows rows={2} columns={1} />
              ) : t.quizzesOpen.length === 0 ? (
                <EmptyState icon={<ListChecks />} title="No quizzes open right now" compact />
              ) : (
                <ul className="-my-2 flex flex-col divide-y divide-border">
                  {t.quizzesOpen.map((q) => (
                    <li key={q.id}>
                      <Link href={`/student/quizzes/${q.id}`} className="-mx-2 flex items-start justify-between gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-2">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-fg">{q.title}</span>
                          <span className="flex flex-wrap items-center gap-x-2 text-[13px] text-fg-muted">
                            <span>{q.subject}</span>
                            <span>{q.questions} questions</span>
                            {q.timeLimitMin && (
                              <span className="inline-flex items-center gap-1">
                                <Timer className="size-3.5" aria-hidden />
                                {q.timeLimitMin} min
                              </span>
                            )}
                            {q.closesAt && <span>Closes {dueText(q.closesAt).replace(/^Due /, "").toLowerCase()}</span>}
                          </span>
                        </span>
                        {q.inProgressAttemptId ? (
                          <Badge tone="warning">In progress</Badge>
                        ) : q.attemptsLeft > 0 ? (
                          <Badge tone="primary">{q.attemptsUsed ? `${q.attemptsLeft} left` : "Start"}</Badge>
                        ) : (
                          <Badge tone="success">Done</Badge>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card>
            <CardHeader icon={<Megaphone />} title="Notices" action={<SeeAll href="/student/noticeboard">Noticeboard</SeeAll>} />
            {!t ? (
              <SkeletonRows rows={3} columns={1} />
            ) : t.announcements.length === 0 ? (
              <EmptyState icon={<Megaphone />} title="No notices yet" compact />
            ) : (
              <NoticeList notices={t.announcements.slice(0, 3)} />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

const rank = (s: string) => (s === "live" ? 0 : s === "upcoming" ? 1 : s === "ended" ? 2 : 3);

function HeroStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | null }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2.5">
      <dt className="flex items-center gap-1.5 text-xs text-fg-muted [&_svg]:size-3.5">
        <span aria-hidden className="text-brand">{icon}</span>
        {label}
      </dt>
      <dd className="mt-0.5 font-display text-xl font-semibold tabular-nums text-fg">{value ?? <Skeleton className="h-6 w-8" />}</dd>
    </div>
  );
}

function PeriodRow({ period: p, nowMinutes }: { period: TodayPeriod; nowMinutes: number | null }) {
  const start = minutes(p.startTime);
  const end = minutes(p.endTime);
  const current = nowMinutes !== null && nowMinutes >= start && nowMinutes < end;
  if (p.isBreak) {
    return (
      <li className={cn("flex items-center gap-3 rounded-lg px-3 py-1.5 text-[13px] text-fg-muted", current && "bg-surface-2")}>
        <span className="w-32 shrink-0 tabular-nums">
          {periodTime(p.startTime)} to {periodTime(p.endTime)}
        </span>
        <Coffee className="size-3.5" aria-hidden />
        <span>{p.name}</span>
        {current && <Badge tone="info">Now</Badge>}
      </li>
    );
  }
  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-lg border px-3 py-2.5",
        current ? "border-primary bg-primary-tint" : "border-border",
      )}
      aria-current={current ? "time" : undefined}
    >
      <span className="w-32 shrink-0 text-[13px] tabular-nums text-fg-secondary">
        {periodTime(p.startTime)} to {periodTime(p.endTime)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-fg">{p.subject ?? p.name}</span>
        <span className="block truncate text-[13px] text-fg-muted">{[p.name, p.teacher, p.room && roomLabel(p.room)].filter(Boolean).join(". ")}</span>
      </span>
      {current && <Badge tone="primary">Now</Badge>}
    </li>
  );
}
