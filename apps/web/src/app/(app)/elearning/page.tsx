"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, CalendarRange, ClipboardCheck, FileQuestion, MonitorPlay, Plus, Video } from "lucide-react";
import {
  Badge,
  buttonClass,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  KpiCard,
  PageHeader,
  ProgressBar,
  SkeletonRows,
  StatGrid,
  StatusPill,
} from "@/components/ui";
import { courseColor, sectionName, type CourseSummary } from "@/components/elearning/courses-types";
import { formatBytes } from "@/components/elearning/file-upload";
import { LiveStatusPill, useNow } from "@/components/elearning/live-status";
import { countdown, liveTime, sectionLabel, type LiveClass } from "@/components/elearning/live-types";
import { day, todayIso } from "@/lib/format";
import { useCan } from "@/lib/session";
import { useApi } from "@/lib/use-api";

interface AssignmentRow {
  id: string;
  title: string;
  dueAt: string;
  isPublished: boolean;
  section: { name: string; class: { name: string } };
  subject: { name: string };
  studentCount: number;
  submittedCount: number;
  toGradeCount: number;
  lateCount: number;
}

interface QuizRow {
  id: string;
  title: string;
  updatedAt: string;
  closesAt: string | null;
  isPublished: boolean;
  section: { name: string; class: { name: string } };
  subject: { name: string };
  window: "upcoming" | "open" | "closed";
  studentCount: number;
  studentsAttempted: number;
  attemptCount: number;
  needsReviewCount: number;
  avgPercent: number | null;
}

interface StorageUsage {
  usedBytes: number;
  files: number;
  limitBytes: number | null;
}

const sectionOf = (r: { section: { name: string; class: { name: string } } }) => `${r.section.class.name} ${r.section.name}`;

export default function ElearningOverviewPage() {
  const can = useCan();
  const canManage = can("elearning", "manage");
  const today = todayIso();
  const now = useNow();
  const live = useApi<LiveClass[]>(`/elearning/live?from=${today}&to=${today}`);
  const assignments = useApi<AssignmentRow[]>("/elearning/assignments");
  const quizzes = useApi<QuizRow[]>("/elearning/quizzes");
  const courses = useApi<CourseSummary[]>("/elearning/courses");
  const storage = useApi<StorageUsage>(canManage ? "/elearning/files/usage" : null);

  const liveToday = (live.data ?? []).filter((c) => c.status !== "CANCELLED");
  const liveNow = liveToday.filter((c) => c.status === "LIVE").length;
  // Live and upcoming classes first, then the ones already held; the rest are on the live classes page.
  const liveShown = [...liveToday.filter((c) => c.status !== "ENDED"), ...liveToday.filter((c) => c.status === "ENDED")].slice(0, 8);
  const toGrade = (assignments.data ?? []).filter((a) => a.toGradeCount > 0).sort((a, b) => b.toGradeCount - a.toGradeCount || a.dueAt.localeCompare(b.dueAt));
  const toGradeTotal = toGrade.reduce((n, a) => n + a.toGradeCount, 0);
  const quizResults = (quizzes.data ?? [])
    .filter((q) => q.attemptCount > 0)
    .sort((a, b) => (b.closesAt ?? b.updatedAt).localeCompare(a.closesAt ?? a.updatedAt))
    .slice(0, 6);
  const needsReview = (quizzes.data ?? []).reduce((n, q) => n + q.needsReviewCount, 0);
  const publishedCourses = (courses.data ?? []).filter((c) => c.isPublished);
  const avgCompletion = publishedCourses.length ? Math.round(publishedCourses.reduce((n, c) => n + c.avgCompletion, 0) / publishedCourses.length) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="E-school"
        description="Today's live classes, work waiting for marks and how students are moving through courses."
        actions={
          canManage && (
            <>
              <Link href="/elearning/courses" className={buttonClass("secondary")}>
                <BookOpen className="size-4" aria-hidden />
                Courses
              </Link>
              <Link href="/elearning/live" className={buttonClass("primary")}>
                <Plus className="size-4" aria-hidden />
                Schedule live class
              </Link>
            </>
          )
        }
      />

      <StatGrid>
        <KpiCard
          label="Live classes today"
          value={liveToday.length}
          icon={<Video />}
          loading={!live.data && !live.error}
          hint={liveNow ? `${liveNow} live now` : undefined}
          href="/elearning/live"
        />
        <KpiCard label="Submissions to grade" value={toGradeTotal} icon={<ClipboardCheck />} tone={toGradeTotal ? "warning" : "success"} loading={!assignments.data && !assignments.error} hint={`across ${toGrade.length} ${toGrade.length === 1 ? "assignment" : "assignments"}`} />
        <KpiCard label="Quiz answers to review" value={needsReview} icon={<FileQuestion />} tone={needsReview ? "warning" : "info"} loading={!quizzes.data && !quizzes.error} hint="Short answers that need a teacher" />
        <KpiCard
          label="Average course completion"
          value={avgCompletion == null ? "No data" : `${avgCompletion}%`}
          icon={<BookOpen />}
          tone="success"
          loading={!courses.data && !courses.error}
          hint={`${publishedCourses.length} published ${publishedCourses.length === 1 ? "course" : "courses"}`}
          href="/elearning/courses"
        />
      </StatGrid>

      {storage.data && (
        <Card padding="sm" className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
          <p className="shrink-0 px-1 text-sm text-fg-secondary">
            <span className="font-medium text-fg">File storage</span> · {storage.data.files} {storage.data.files === 1 ? "file" : "files"}
          </p>
          {storage.data.limitBytes ? (
            <ProgressBar
              className="flex-1"
              size="sm"
              value={storage.data.usedBytes}
              max={storage.data.limitBytes}
              valueText={`${formatBytes(storage.data.usedBytes)} of ${formatBytes(storage.data.limitBytes)}`}
              tone={storage.data.usedBytes / storage.data.limitBytes > 0.9 ? "danger" : "primary"}
            />
          ) : (
            <p className="text-sm tabular-nums text-fg-muted">{formatBytes(storage.data.usedBytes)} used, no limit on this plan</p>
          )}
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Today's live classes"
            icon={<MonitorPlay />}
            action={
              <Link href="/elearning/live" className={buttonClass("ghost", "sm")}>
                All live classes <ArrowRight className="size-4" aria-hidden />
              </Link>
            }
          />
          {live.error ? (
            <ErrorState message={live.error} onRetry={live.reload} compact />
          ) : !live.data ? (
            <SkeletonRows rows={4} />
          ) : liveToday.length === 0 ? (
            <EmptyState
              icon={<CalendarRange />}
              title="No live classes today"
              description="Schedule a class, or create a whole week from the timetable."
              action={
                canManage ? (
                  <Link href="/elearning/live" className={buttonClass("secondary", "sm")}>
                    Go to live classes
                  </Link>
                ) : undefined
              }
              compact
            />
          ) : (
            <>
              <ul className="divide-y divide-border">
                {liveShown.map((c) => {
                  const upcoming = c.status === "SCHEDULED" && new Date(c.startsAt).getTime() > now;
                  return (
                    <li key={c.id} className="flex flex-wrap items-center gap-3 py-3">
                      <span className="w-14 shrink-0 text-sm font-semibold tabular-nums text-fg">{liveTime(c.startsAt)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-fg">{c.title}</p>
                        <p className="truncate text-[13px] text-fg-muted">
                          {sectionLabel(c)} · {c.teacher?.name ?? "No teacher"} · {c.durationMin} min
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {upcoming ? <span className="text-[13px] tabular-nums text-fg-muted">{countdown(c.startsAt, now)}</span> : <LiveStatusPill status={c.status} />}
                        {c.status === "ENDED" && <span className="text-[13px] tabular-nums text-fg-muted">{c.attendanceCount} joined</span>}
                        {(c.status === "LIVE" || c.joinWindow === "open") && c.status !== "ENDED" && (
                          <a href={c.joinUrl} target="_blank" rel="noopener noreferrer" className={buttonClass(c.status === "LIVE" ? "primary" : "secondary", "sm")}>
                            Open meeting
                          </a>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {liveToday.length > liveShown.length && (
                <Link href="/elearning/live" className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
                  +{liveToday.length - liveShown.length} more today <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              )}
            </>
          )}
        </Card>

        <Card>
          <CardHeader title="Submissions to grade" icon={<ClipboardCheck />} />
          {assignments.error ? (
            <ErrorState message={assignments.error} onRetry={assignments.reload} compact />
          ) : !assignments.data ? (
            <SkeletonRows rows={4} />
          ) : toGrade.length === 0 ? (
            <EmptyState title="All caught up" description="New submissions show up here until you grade them." compact />
          ) : (
            <ul className="-mx-2 flex flex-col">
              {toGrade.slice(0, 6).map((a) => (
                <li key={a.id}>
                  <Link href={`/elearning/assignments/${a.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fg">{a.title}</p>
                      <p className="truncate text-[13px] text-fg-muted">
                        {sectionOf(a)} · {a.subject.name} · due {day(a.dueAt)}
                      </p>
                    </div>
                    <Badge tone="warning">{a.toGradeCount} to grade</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Recent quiz results"
            icon={<FileQuestion />}
            action={
              <Link href="/elearning/quizzes" className={buttonClass("ghost", "sm")}>
                All quizzes <ArrowRight className="size-4" aria-hidden />
              </Link>
            }
          />
          {quizzes.error ? (
            <ErrorState message={quizzes.error} onRetry={quizzes.reload} compact />
          ) : !quizzes.data ? (
            <SkeletonRows rows={4} />
          ) : quizResults.length === 0 ? (
            <EmptyState title="No quiz attempts yet" description="Scores appear here once students submit a quiz." compact />
          ) : (
            <ul className="-mx-2 flex flex-col">
              {quizResults.map((q) => (
                <li key={q.id}>
                  <Link href={`/elearning/quizzes/${q.id}`} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 rounded-lg px-2 py-2.5 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fg">{q.title}</p>
                      <p className="truncate text-[13px] text-fg-muted">
                        {sectionOf(q)} · {q.subject.name} · {q.studentsAttempted} of {q.studentCount} attempted
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {q.needsReviewCount > 0 && <StatusPill status="REVIEW" label={`${q.needsReviewCount} to review`} />}
                      <StatusPill status={q.window === "open" ? "OPEN" : q.window === "upcoming" ? "UPCOMING" : "CLOSED"} />
                    </div>
                    <ProgressBar
                      className="col-span-2"
                      size="sm"
                      value={q.avgPercent ?? 0}
                      label="Average score"
                      valueText={q.avgPercent == null ? "Not marked" : `${Math.round(q.avgPercent)}%`}
                      tone={q.avgPercent == null ? "neutral" : q.avgPercent >= 70 ? "success" : q.avgPercent >= 50 ? "warning" : "danger"}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Course completion"
            icon={<BookOpen />}
            description="Average share of published lessons students have finished"
            action={
              <Link href="/elearning/courses" className={buttonClass("ghost", "sm")}>
                All courses <ArrowRight className="size-4" aria-hidden />
              </Link>
            }
          />
          {courses.error ? (
            <ErrorState message={courses.error} onRetry={courses.reload} compact />
          ) : !courses.data ? (
            <SkeletonRows rows={4} />
          ) : courses.data.length === 0 ? (
            <EmptyState
              title="No courses yet"
              description="Create courses for your sections to share video lessons, readings and links."
              action={
                canManage ? (
                  <Link href="/elearning/courses" className={buttonClass("secondary", "sm")}>
                    Set up courses
                  </Link>
                ) : undefined
              }
              compact
            />
          ) : (
            <ul className="flex flex-col gap-4">
              {[...courses.data]
                .sort((a, b) => Number(b.isPublished) - Number(a.isPublished) || a.avgCompletion - b.avgCompletion)
                .slice(0, 7)
                .map((c) => (
                  <li key={c.id}>
                    <Link href={`/elearning/courses/${c.id}`} className="block rounded-lg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
                      <ProgressBar
                        value={c.avgCompletion}
                        tone={c.avgCompletion >= 70 ? "success" : c.avgCompletion >= 35 ? "primary" : "warning"}
                        label={
                          <span className="flex items-center gap-2">
                            <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: courseColor(c) }} />
                            <span className="truncate text-fg">{c.title}</span>
                            <span className="truncate text-fg-muted">{sectionName(c.section)}</span>
                            {!c.isPublished && <StatusPill status="DRAFT" />}
                          </span>
                        }
                        valueText={`${Math.round(c.avgCompletion)}%`}
                      />
                    </Link>
                  </li>
                ))}
            </ul>
          )}
          {courses.data && courses.data.length > 7 && (
            <div className="mt-4 flex justify-end">
              <Link href="/elearning/courses" className={buttonClass("ghost", "sm")}>
                {courses.data.length - 7} more courses
              </Link>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
