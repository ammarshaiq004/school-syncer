"use client";

import { BookOpen, CalendarClock, ClipboardList, ListChecks, Video } from "lucide-react";
import { ASSIGNMENT_STATE } from "@/components/student/format";
import { clockTime, countdown, LiveNowBadge, PROVIDER_LABEL, shortDay, useNow } from "@/components/student/live-widgets";
import {
  Badge,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorState,
  KpiCard,
  ProgressBar,
  Section,
  SkeletonCards,
  SkeletonRows,
  StatGrid,
  StatusPill,
  TabPanel,
  Tabs,
  type Column,
} from "@/components/ui";
import { useApi } from "@/lib/use-api";
import { courseColor, dateTime, plural, scoreTone } from "./format";
import type { ParentLearning } from "./types";

type Assignment = ParentLearning["assignments"][number];
type Quiz = ParentLearning["quizzes"][number];

/** Parent Dashboard: one child's online learning (course progress, live classes, assignments, quizzes). */
export function ChildLearning({ studentId, name }: { studentId: string; name: string }) {
  const { data, error, reload } = useApi<ParentLearning>(`/parent/children/${studentId}/learning`);
  const first = name.split(" ")[0];

  const avgCourse = data?.courses.length ? Math.round(data.courses.reduce((n, c) => n + c.percent, 0) / data.courses.length) : null;
  const open = data?.assignments.filter((a) => a.status === "pending" || a.status === "overdue" || a.status === "returned").length ?? 0;
  const missing = data?.assignments.filter((a) => a.status === "missing" || a.status === "overdue").length ?? 0;
  const quizBest = data?.quizzes.filter((q) => q.best?.percent != null) ?? [];
  const avgQuiz = quizBest.length ? Math.round(quizBest.reduce((n, q) => n + q.best!.percent!, 0) / quizBest.length) : null;

  const assignmentCols: Column<Assignment>[] = [
    {
      id: "title",
      header: "Assignment",
      sortValue: (r) => r.title,
      cell: (r) => (
        <span className="block min-w-0">
          <span className="block truncate font-medium text-fg">{r.title}</span>
          <span className="block truncate text-xs text-fg-muted">{r.subject}</span>
        </span>
      ),
    },
    { id: "due", header: "Due", sortValue: (r) => r.dueAt, hideBelow: "sm", cell: (r) => <span className="tabular-nums text-fg-secondary">{dateTime(r.dueAt)}</span> },
    {
      id: "status",
      header: "Status",
      sortValue: (r) => r.status,
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusPill status={r.status} label={ASSIGNMENT_STATE[r.status].label} tone={ASSIGNMENT_STATE[r.status].tone} />
          {r.isLate && <StatusPill status="LATE" label="Late" />}
        </span>
      ),
    },
    {
      id: "points",
      header: "Points",
      align: "right",
      sortValue: (r) => (r.points == null ? -1 : r.points / r.maxPoints),
      cell: (r) =>
        r.points == null ? (
          <span className="text-fg-muted">Not graded</span>
        ) : (
          <span className="font-medium text-fg" title={r.feedback ?? undefined}>
            {r.points}
            <span className="text-fg-muted">/{r.maxPoints}</span>
          </span>
        ),
    },
  ];

  const quizCols: Column<Quiz>[] = [
    {
      id: "title",
      header: "Quiz",
      sortValue: (r) => r.title,
      cell: (r) => (
        <span className="block min-w-0">
          <span className="block truncate font-medium text-fg">{r.title}</span>
          <span className="block truncate text-xs text-fg-muted">{r.subject}</span>
        </span>
      ),
    },
    {
      id: "state",
      header: "Status",
      cell: (r) =>
        r.inProgress ? (
          <Badge tone="warning">In progress</Badge>
        ) : r.submitted ? (
          <Badge tone="success">Taken</Badge>
        ) : r.isOpen ? (
          <Badge tone="primary">Open, not taken</Badge>
        ) : r.opensAt && new Date(r.opensAt) > new Date() ? (
          <Badge tone="info">Opens {dateTime(r.opensAt)}</Badge>
        ) : (
          <Badge tone="neutral">Missed</Badge>
        ),
    },
    {
      id: "attempts",
      header: "Attempts",
      align: "right",
      hideBelow: "sm",
      cell: (r) => (
        <span className="text-fg-secondary">
          {r.submitted}/{r.attemptsAllowed}
        </span>
      ),
    },
    {
      id: "best",
      header: "Best score",
      align: "right",
      sortValue: (r) => r.best?.percent ?? -1,
      cell: (r) =>
        r.resultsHidden && r.submitted ? (
          <span className="text-fg-muted">Not shared yet</span>
        ) : r.best?.percent != null ? (
          <span className="inline-flex items-center gap-2">
            {r.latest?.needsReview && <span className="text-xs text-warning-text">Being marked</span>}
            <span className="font-medium text-fg">
              {r.best.score}/{r.best.maxScore}
            </span>
            <Badge tone={scoreTone(r.best.percent)}>{Math.round(r.best.percent)}%</Badge>
          </span>
        ) : (
          <span className="text-fg-muted">None</span>
        ),
    },
  ];

  return (
    <Section title="Learning" description={`${first}'s online courses, live classes, assignments and quizzes.`}>
      {error && !data ? (
        <Card padding="none">
          <ErrorState message={error} onRetry={reload} compact />
        </Card>
      ) : !data ? (
        <>
          <SkeletonCards count={4} />
          <Card>
            <SkeletonRows rows={4} />
          </Card>
        </>
      ) : (
        <div className="flex flex-col gap-6">
          <StatGrid>
            <KpiCard
              label="Course progress"
              value={avgCourse == null ? "No courses" : `${avgCourse}%`}
              icon={<BookOpen />}
              tone={avgCourse == null ? "neutral" : avgCourse >= 60 ? "success" : "primary"}
              hint={data.courses.length ? `Average across ${plural(data.courses.length, "course")}` : undefined}
            />
            <KpiCard
              label="Live classes joined"
              value={data.liveAttendance.held ? `${data.liveAttendance.percent ?? 0}%` : "None held"}
              icon={<Video />}
              tone={!data.liveAttendance.held ? "neutral" : (data.liveAttendance.percent ?? 0) >= 80 ? "success" : "warning"}
              hint={data.liveAttendance.held ? `${data.liveAttendance.attended} of ${data.liveAttendance.held} in the last 30 days` : "Last 30 days"}
            />
            <KpiCard
              label="Assignments to do"
              value={open}
              icon={<ClipboardList />}
              tone={missing ? "danger" : open ? "warning" : "success"}
              hint={missing ? `${missing} overdue or missing` : open ? "None overdue" : "All handed in"}
            />
            <KpiCard
              label="Quiz average"
              value={avgQuiz == null ? "None yet" : `${avgQuiz}%`}
              icon={<ListChecks />}
              tone={avgQuiz == null ? "neutral" : scoreTone(avgQuiz)}
              hint={quizBest.length ? `Best scores of ${plural(quizBest.length, "quiz", "quizzes")}` : undefined}
            />
          </StatGrid>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader icon={<BookOpen />} title="Courses" description="Lessons completed in each subject" />
              {data.courses.length === 0 ? (
                <EmptyState icon={<BookOpen />} title="No courses yet" description="Courses appear once teachers publish them." compact />
              ) : (
                <ul className="flex flex-col gap-4">
                  {data.courses.map((c) => (
                    <li key={c.id} className="flex items-center gap-3">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: courseColor(c.color) }} aria-hidden />
                      <ProgressBar
                        className="flex-1"
                        value={c.completed}
                        max={Math.max(1, c.lessons)}
                        label={`${c.subject}${c.teacher ? `, ${c.teacher}` : ""}`}
                        valueText={`${c.completed}/${c.lessons} lessons`}
                        tone={c.lessons > 0 && c.completed >= c.lessons ? "success" : "primary"}
                        size="sm"
                      />
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader icon={<CalendarClock />} title="Upcoming live classes" />
              {data.liveClasses.length === 0 ? (
                <EmptyState icon={<Video />} title="No live classes scheduled" description="Online classes scheduled by teachers show here." compact />
              ) : (
                <ul className="-my-2 flex flex-col divide-y divide-border">
                  {data.liveClasses.slice(0, 6).map((l) => (
                    <LiveRow key={l.id} live={l} />
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card padding="none">
            <Tabs
              aria-label={`${first}'s assessments`}
              listClassName="px-4"
              tabs={[
                { value: "assignments", label: "Assignments", count: data.assignments.length },
                { value: "quizzes", label: "Quizzes", count: data.quizzes.length },
              ]}
            >
              <TabPanel value="assignments" className="pt-0">
                <DataTable
                  bare
                  label={`${first}'s assignments`}
                  columns={assignmentCols}
                  data={data.assignments}
                  getRowId={(r) => r.id}
                  defaultSort={{ id: "due", dir: "desc" }}
                  pageSize={10}
                  empty={{ title: "No assignments yet", description: "Published assignments and their grades appear here." }}
                />
              </TabPanel>
              <TabPanel value="quizzes" className="pt-0">
                <DataTable
                  bare
                  label={`${first}'s quizzes`}
                  columns={quizCols}
                  data={data.quizzes}
                  getRowId={(r) => r.id}
                  pageSize={10}
                  empty={{ title: "No quizzes yet", description: "Quiz scores appear here once teachers publish quizzes." }}
                />
              </TabPanel>
            </Tabs>
          </Card>
        </div>
      )}
    </Section>
  );
}

function LiveRow({ live: l }: { live: ParentLearning["liveClasses"][number] }) {
  const now = useNow(30_000);
  const start = new Date(l.startsAt).getTime();
  const live = l.state === "live" || (now !== null && now >= start && now < new Date(l.endsAt).getTime());
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-fg">{l.title}</span>
        <span className="block truncate text-[13px] text-fg-muted">
          {[l.subject, l.teacher, PROVIDER_LABEL[l.provider]].filter(Boolean).join(", ")}
        </span>
      </span>
      <span className="shrink-0 text-right">
        {live ? (
          <LiveNowBadge />
        ) : l.state === "cancelled" ? (
          <Badge tone="neutral">Cancelled</Badge>
        ) : (
          <>
            <span className="block text-[13px] tabular-nums text-fg">
              {shortDay(l.startsAt)}, {clockTime(l.startsAt)}
            </span>
            {now !== null && start > now && <span className="block text-xs tabular-nums text-fg-muted">in {countdown(start - now)}</span>}
          </>
        )}
      </span>
    </li>
  );
}
