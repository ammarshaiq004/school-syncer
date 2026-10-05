"use client";

import Link from "next/link";
import { BookOpen, CalendarCheck, CalendarClock, ClipboardCheck, Layers, Megaphone, NotebookPen, Users } from "lucide-react";
import {
  Badge,
  buttonClass,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  KpiCard,
  PageHeader,
  ProgressRing,
  StatGrid,
  StatusPill,
  type Column,
} from "@/components/ui";
import type { Feature } from "@/lib/api";
import { cn } from "@/lib/cn";
import { allNavItems } from "@/lib/nav";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";
import {
  firstName,
  greeting,
  longDate,
  NoticeBoard,
  QuickActions,
  SectionState,
  ViewAll,
  type Notice,
  type QuickAction,
} from "./shared";

interface MySection {
  id: string;
  name: string;
  students: number;
  isClassTeacher: boolean;
  mySubjects: { id: string; name: string }[];
  attendanceTaken: boolean;
}
interface HomeworkDue {
  id: string;
  title: string;
  dueDate: string;
  subject: string;
  section: string;
  sectionId: string;
  mine: boolean;
}
interface TeacherDay {
  date: string;
  sections: MySection[];
  homeworkDue: HomeworkDue[];
}
interface Slot {
  id: string;
  dayOfWeek: number;
  period: string;
  startTime: string;
  endTime: string;
  subject: string;
  section: string;
  room: string | null;
}

const dueLabel = (iso: string, today: string) => {
  if (iso === today) return { text: "Due today", tone: "danger" as const };
  const days = Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  if (days === 1) return { text: "Tomorrow", tone: "warning" as const };
  return {
    text: new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }),
    tone: "neutral" as const,
  };
};

export function TeacherDashboard() {
  const user = useSession();
  const features = user.plan?.features;
  const has = (f: Feature) => !features || features.includes(f);
  const reachable = new Set(allNavItems(user).map((i) => i.href));
  const now = new Date();
  const todayIso = now.toLocaleDateString("en-CA");
  const dow = now.getDay() === 0 ? 7 : now.getDay();
  const hhmm = now.toTimeString().slice(0, 5);

  const day = useApi<TeacherDay>("/dashboard/teacher");
  const timetable = useApi<Slot[]>(has("timetable") ? "/timetable/me" : null);
  const notices = useApi<Notice[]>("/announcements");

  const d = day.data;
  const sections = d?.sections;
  const pending = sections?.filter((s) => !s.attendanceTaken) ?? [];
  // Open the register that is actually waiting, not the empty picker: /attendance
  // reads ?section= from the URL.
  const takeHref = pending[0] ? `/attendance?section=${pending[0].id}` : "/attendance";
  const students = sections?.reduce((n, s) => n + s.students, 0) ?? 0;
  const todaySlots = timetable.data?.filter((s) => s.dayOfWeek === dow) ?? null;
  const weekFrom = todayIso;
  const weekTo = new Date(Date.parse(`${todayIso}T00:00:00Z`) + 6 * 86400000).toISOString().slice(0, 10);
  const dueThisWeek = d?.homeworkDue.filter((h) => h.dueDate >= weekFrom && h.dueDate <= weekTo).length ?? 0;
  const loading = !d && !day.error;

  const quickActions: QuickAction[] = (
    [
      { href: "/attendance", label: "Take attendance", description: "Mark today's register", icon: <CalendarCheck /> },
      { href: "/homework", label: "Set homework", description: "Post to a section's diary", icon: <NotebookPen /> },
      { href: "/exams", label: "Enter marks", description: "Exams and results", icon: <ClipboardCheck /> },
      { href: "/timetable", label: "My timetable", description: "Your periods this week", icon: <CalendarClock /> },
      { href: "/students", label: "My students", description: "Profiles and contacts", icon: <Users /> },
      { href: "/announcements", label: "Notices", description: "School announcements", icon: <Megaphone /> },
    ] satisfies QuickAction[]
  ).filter((a) => reachable.has(a.href));

  const sectionColumns: Column<MySection>[] = [
    {
      id: "name",
      header: "Section",
      sortValue: (s) => s.name,
      cell: (s) => (
        <span className="flex flex-col">
          <span className="font-medium text-fg">{s.name}</span>
          {s.isClassTeacher && <span className="text-xs text-fg-muted">Class teacher</span>}
        </span>
      ),
    },
    {
      id: "subjects",
      header: "Your subjects",
      hideBelow: "md",
      cell: (s) =>
        s.mySubjects.length ? (
          <span className="flex flex-wrap gap-1">
            {s.mySubjects.map((x) => (
              <Badge key={x.id} tone="primary">
                {x.name}
              </Badge>
            ))}
          </span>
        ) : (
          <span className="text-fg-muted">All subjects</span>
        ),
    },
    { id: "students", header: "Students", align: "right", sortValue: (s) => s.students, cell: (s) => s.students.toLocaleString("en-PK") },
    {
      id: "today",
      header: "Today's register",
      sortValue: (s) => (s.attendanceTaken ? 1 : 0),
      cell: (s) => <StatusPill status={s.attendanceTaken ? "COMPLETED" : "PENDING"} label={s.attendanceTaken ? "Taken" : "Not taken"} />,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${greeting(now)}, ${firstName(user.name)}`}
        description={
          d
            ? `${longDate(now)} · ${
                todaySlots ? `${todaySlots.length} ${todaySlots.length === 1 ? "period" : "periods"} today, ` : ""
              }${pending.length ? `${pending.length} ${pending.length === 1 ? "register" : "registers"} to take` : "all registers taken"}`
            : longDate(now)
        }
        actions={
          <>
            {reachable.has("/homework") && (
              <Link href="/homework" className={buttonClass("secondary")}>
                <NotebookPen aria-hidden />
                Set homework
              </Link>
            )}
            {reachable.has("/attendance") && (
              <Link href={takeHref} className={buttonClass("primary")}>
                <CalendarCheck aria-hidden />
                Take attendance
              </Link>
            )}
          </>
        }
      />

      <StatGrid>
        <KpiCard
          label="My sections"
          value={sections?.length.toLocaleString("en-PK") ?? ""}
          icon={<Layers />}
          loading={loading}
          hint={sections ? `Class teacher of ${sections.filter((s) => s.isClassTeacher).length}` : undefined}
        />
        <KpiCard label="My students" value={students.toLocaleString("en-PK")} icon={<Users />} tone="info" loading={loading} href="/students" />
        <KpiCard
          label="Registers to take"
          value={sections ? pending.length.toLocaleString("en-PK") : ""}
          icon={<CalendarCheck />}
          tone={pending.length ? "warning" : "success"}
          href={takeHref}
          loading={loading}
          hint={sections ? `${sections.length - pending.length} of ${sections.length} taken today` : undefined}
          sparkline={
            sections && sections.length > 0 ? (
              <ProgressRing value={sections.length - pending.length} max={sections.length} size={40} stroke={4} tone="success" label="Registers taken today" />
            ) : undefined
          }
        />
        {has("timetable") ? (
          <KpiCard
            label="Periods today"
            value={todaySlots ? todaySlots.length.toLocaleString("en-PK") : ""}
            icon={<CalendarClock />}
            tone="neutral"
            href="/timetable"
            loading={!todaySlots && !timetable.error}
            hint={timetable.error ? "Timetable unavailable" : todaySlots?.[0] ? `First at ${todaySlots[0].startTime}` : "No periods today"}
          />
        ) : (
          <KpiCard
            label="Homework due this week"
            value={d ? dueThisWeek.toLocaleString("en-PK") : ""}
            icon={<NotebookPen />}
            tone="neutral"
            loading={loading}
          />
        )}
      </StatGrid>

      <div className="grid gap-6 lg:grid-flow-row-dense lg:grid-cols-3">
        {has("timetable") && (
          <Card className="lg:col-span-2">
            <CardHeader
              title="Today's timetable"
              description={now.toLocaleDateString("en-GB", { weekday: "long" })}
              icon={<CalendarClock />}
              action={<ViewAll href="/timetable" label="Full week" />}
            />
            <SectionState
              data={todaySlots}
              error={timetable.error}
              onRetry={timetable.reload}
              empty={{ title: "No periods today", description: "Enjoy the free day, or check the full week.", icon: <CalendarClock /> }}
            >
              {(slots) => (
                <ol className="flex flex-col gap-2">
                  {slots.map((s) => {
                    const current = s.startTime <= hhmm && hhmm < s.endTime;
                    const past = s.endTime <= hhmm;
                    return (
                      <li
                        key={s.id}
                        aria-current={current ? "time" : undefined}
                        className={cn(
                          "flex items-center gap-4 rounded-lg border border-l-[3px] px-3 py-2.5",
                          current ? "border-primary bg-primary-tint" : "border-border border-l-border-strong bg-surface",
                          past && "opacity-70",
                        )}
                      >
                        <span className="w-24 shrink-0 text-[13px] tabular-nums text-fg-secondary">
                          {s.startTime} to {s.endTime}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-fg">{s.subject}</span>
                          <span className="block truncate text-xs text-fg-muted">
                            {s.section} · {s.period}
                            {s.room ? ` · Room ${s.room}` : ""}
                          </span>
                        </span>
                        {current && <StatusPill status="LIVE" label="Now" tone="primary" />}
                      </li>
                    );
                  })}
                </ol>
              )}
            </SectionState>
          </Card>
        )}

        <Card>
          <CardHeader title="Attendance to take" description="Today's registers" icon={<CalendarCheck />} action={<ViewAll href="/attendance" label="Open" />} />
          <SectionState
            data={sections}
            error={day.error}
            onRetry={day.reload}
            empty={{ title: "No sections assigned", description: "Ask the school office to assign you a class or subject.", icon: <Layers /> }}
          >
            {(list) =>
              pending.length === 0 ? (
                <EmptyState icon={<CalendarCheck />} title="All registers are in" description={`You have marked all ${list.length} of your sections today.`} compact />
              ) : (
                <ul className="-my-2 divide-y divide-border">
                  {[...list]
                    .sort((a, b) => Number(a.attendanceTaken) - Number(b.attendanceTaken))
                    .map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-fg">{s.name}</span>
                          <span className="block text-xs text-fg-muted">{s.students} students</span>
                        </span>
                        {s.attendanceTaken ? (
                          <StatusPill status="COMPLETED" label="Taken" />
                        ) : (
                          <Link href={`/attendance?section=${s.id}`} className={buttonClass("secondary", "sm")} aria-label={`Take attendance for ${s.name}`}>
                            Take
                          </Link>
                        )}
                      </li>
                    ))}
                </ul>
              )
            }
          </SectionState>
        </Card>

        <Card padding="none" className="lg:col-span-2">
          <div className="px-5 pt-5 sm:px-6 sm:pt-6">
            <CardHeader title="My sections" description="Classes you teach this year" icon={<BookOpen />} />
          </div>
          <DataTable
            label="My sections"
            bare
            dense
            pageSize={0}
            skeletonRows={4}
            columns={sectionColumns}
            data={sections ?? null}
            error={day.error}
            onRetry={day.reload}
            getRowId={(s) => s.id}
            empty={{ title: "No sections assigned", description: "Sections where you are class teacher or teach a subject show here." }}
          />
        </Card>

        {has("homework") && (
          <Card>
            <CardHeader title="Homework due" description="Coming up in your sections" icon={<NotebookPen />} action={<ViewAll href="/homework" />} />
            <SectionState
              data={d?.homeworkDue}
              error={day.error}
              onRetry={day.reload}
              empty={{
                title: "Nothing due",
                description: "Homework you set will show here until it is due.",
                icon: <NotebookPen />,
                action: reachable.has("/homework") ? (
                  <Link href="/homework" className={buttonClass("secondary", "sm")}>
                    Set homework
                  </Link>
                ) : undefined,
              }}
            >
              {(list) => (
                <ul className="-my-2 divide-y divide-border">
                  {list.map((h) => {
                    const due = dueLabel(h.dueDate, todayIso);
                    return (
                      <li key={h.id} className="flex items-start justify-between gap-3 py-2.5">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-fg">{h.title}</span>
                          <span className="block truncate text-xs text-fg-muted">
                            {h.subject} · {h.section}
                            {h.mine ? "" : " · set by a colleague"}
                          </span>
                        </span>
                        <Badge tone={due.tone} className="shrink-0">
                          {due.text}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              )}
            </SectionState>
          </Card>
        )}

        <NoticeBoard className="lg:col-span-2" notices={notices.data} error={notices.error} onRetry={notices.reload} />

        <QuickActions actions={quickActions} />
      </div>
    </div>
  );
}
