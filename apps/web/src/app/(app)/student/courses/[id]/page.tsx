"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowRight, BookOpen, CircleCheck, Clock } from "lucide-react";
import { courseColor, LESSON_KIND, plural, shortDate } from "@/components/student-learning/format";
import type { StudentCourseDetail, StudentLessonItem } from "@/components/student-learning/types";
import {
  buttonClass,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  ProgressBar,
  ProgressRing,
  Skeleton,
  SkeletonRows,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { useApi } from "@/lib/use-api";

/** A course for the student: units with their lessons, ticks for finished ones and a Continue button. */
export default function StudentCoursePage() {
  const { id } = useParams<{ id: string }>();
  const { data: c, error, errorStatus, reload } = useApi<StudentCourseDetail>(`/student/courses/${id}`);

  if (error && !c) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Course" breadcrumbs={[{ label: "Courses", href: "/student/courses" }, { label: "Course" }]} />
        <Card padding="none">
          {errorStatus === 404 ? (
            <EmptyState
              icon={<BookOpen />}
              title="This course is not available"
              description="It may have been unpublished or belong to another class."
              action={<Link href="/student/courses" className={buttonClass("secondary", "sm")}>Back to courses</Link>}
            />
          ) : (
            <ErrorState message={error} onRetry={reload} />
          )}
        </Card>
      </div>
    );
  }

  const lessons = c?.units.flatMap((u) => u.lessons) ?? [];
  const next = lessons.find((l) => !l.completed) ?? lessons[0];
  const finished = !!c && c.lessonCount > 0 && c.completedCount >= c.lessonCount;
  const color = courseColor(c?.color);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={c?.title ?? "Loading course"}
        description={c ? [c.subject.name, c.teacher?.name].filter(Boolean).join(", taught by ") : undefined}
        breadcrumbs={[{ label: "Courses", href: "/student/courses" }, { label: c?.title ?? "Course" }]}
        leading={
          <span className="grid size-12 place-items-center rounded-xl font-display text-base font-semibold text-primary-fg" style={{ backgroundColor: color }} aria-hidden>
            {c?.subject.name.slice(0, 2).toUpperCase()}
          </span>
        }
        actions={
          next && (
            <Link href={`/student/courses/${id}/lessons/${next.id}`} className={buttonClass("primary")}>
              {finished ? "Review from the start" : c?.completedCount ? "Continue" : "Start course"}
              <ArrowRight aria-hidden />
            </Link>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {!c ? (
            <Card>
              <SkeletonRows rows={6} columns={2} />
            </Card>
          ) : c.units.length === 0 ? (
            <Card padding="none">
              <EmptyState icon={<BookOpen />} title="No lessons yet" description="Your teacher has not published any lessons in this course yet." />
            </Card>
          ) : (
            c.units.map((u, i) => {
              const done = u.lessons.filter((l) => l.completed).length;
              return (
                <Card key={u.id} padding="none">
                  <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
                    <div className="min-w-0">
                      <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">Unit {i + 1}</p>
                      <h2 className="truncate text-base font-semibold text-fg">{u.title}</h2>
                    </div>
                    <span className="shrink-0 text-[13px] tabular-nums text-fg-muted">
                      {done}/{u.lessons.length} done
                    </span>
                  </div>
                  <ol className="divide-y divide-border">
                    {u.lessons.map((l) => (
                      <LessonRow key={l.id} courseId={c.id} lesson={l} current={l.id === next?.id && !finished} />
                    ))}
                  </ol>
                </Card>
              );
            })
          )}
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Your progress" />
            {!c ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <div className="flex items-center gap-4">
                <ProgressRing value={c.percent} size={84} stroke={8} tone={finished ? "success" : "primary"} label={`${c.percent}% of ${c.title} complete`}>
                  <span className="font-display text-lg font-semibold tabular-nums text-fg">{c.percent}%</span>
                </ProgressRing>
                <div className="min-w-0 text-sm">
                  <p className="font-medium text-fg">{finished ? "Course finished, well done" : `${plural(c.lessonCount - c.completedCount, "lesson")} to go`}</p>
                  <p className="text-[13px] text-fg-muted">
                    {c.completedCount} of {plural(c.lessonCount, "lesson")} completed
                  </p>
                </div>
              </div>
            )}
          </Card>
          {c?.description && (
            <Card>
              <CardHeader title="About this course" />
              <p className="whitespace-pre-line text-sm text-fg-secondary">{c.description}</p>
            </Card>
          )}
          {c && c.units.length > 1 && (
            <Card>
              <CardHeader title="Units" />
              <div className="flex flex-col gap-3">
                {c.units.map((u) => {
                  const done = u.lessons.filter((l) => l.completed).length;
                  return (
                    <ProgressBar
                      key={u.id}
                      value={done}
                      max={Math.max(1, u.lessons.length)}
                      label={u.title}
                      valueText={`${done}/${u.lessons.length}`}
                      tone={done === u.lessons.length ? "success" : "primary"}
                      size="sm"
                    />
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function LessonRow({ courseId, lesson: l, current }: { courseId: string; lesson: StudentLessonItem; current: boolean }) {
  const kind = LESSON_KIND[l.kind];
  const Icon = kind.icon;
  return (
    <li>
      <Link
        href={`/student/courses/${courseId}/lessons/${l.id}`}
        className={cn(
          "flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring",
          current && "bg-primary-tint/60",
        )}
        aria-current={current ? "step" : undefined}
      >
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-full",
            l.completed ? "bg-success-tint text-success" : "bg-surface-3 text-fg-secondary",
          )}
          aria-hidden
        >
          {l.completed ? <CircleCheck className="size-4" /> : <Icon className="size-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg">{l.title}</span>
          <span className="flex flex-wrap items-center gap-x-2 text-[13px] text-fg-muted">
            <span>{kind.label}</span>
            {l.durationMin ? (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" aria-hidden />
                {l.durationMin} min
              </span>
            ) : null}
            {l.completed && l.completedAt && <span className="text-success-text">Completed {shortDate(l.completedAt)}</span>}
          </span>
        </span>
        <span className="sr-only">{l.completed ? "Completed" : "Not completed"}</span>
        {current && <span className="shrink-0 text-[13px] font-medium text-brand">Up next</span>}
      </Link>
    </li>
  );
}
