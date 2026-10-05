"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, CircleCheck } from "lucide-react";
import { courseColor, plural } from "@/components/student-learning/format";
import type { StudentCourseCard } from "@/components/student-learning/types";
import { Card, EmptyState, ErrorState, PageHeader, ProgressBar, SkeletonCards } from "@/components/ui";
import { useApi } from "@/lib/use-api";

/** Student courses: one card per subject course with progress and the next lesson. */
export default function StudentCoursesPage() {
  const { data, error, reload } = useApi<StudentCourseCard[]>("/student/courses");
  const done = data?.filter((c) => c.lessonCount > 0 && c.completedCount >= c.lessonCount).length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Courses"
        description={
          data && data.length
            ? `${plural(data.length, "course")} this term${done ? `, ${done} finished` : ""}. Pick up where you left off.`
            : "Lessons, videos and readings from your teachers."
        }
        breadcrumbs={[{ label: "Student Workspace", href: "/student" }, { label: "Courses" }]}
      />

      {error ? (
        <Card padding="none">
          <ErrorState message={error} onRetry={reload} />
        </Card>
      ) : !data ? (
        <SkeletonCards count={6} className="sm:grid-cols-2 xl:grid-cols-3" />
      ) : data.length === 0 ? (
        <Card padding="none">
          <EmptyState
            icon={<BookOpen />}
            title="No courses yet"
            description="When your teachers publish a course for your class, it appears here."
          />
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((c) => (
            <li key={c.id}>
              <CourseCard course={c} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CourseCard({ course: c }: { course: StudentCourseCard }) {
  const finished = c.lessonCount > 0 && c.completedCount >= c.lessonCount;
  const color = courseColor(c.color);
  return (
    <Card padding="none" interactive className="relative flex h-full flex-col overflow-hidden">
      <span className="h-1.5 w-full" style={{ backgroundColor: color }} aria-hidden />
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-start gap-3">
          <span
            className="grid size-10 shrink-0 place-items-center rounded-lg font-display text-sm font-semibold text-primary-fg"
            style={{ backgroundColor: color }}
            aria-hidden
          >
            {c.subject.name.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-fg">
              <Link
                href={`/student/courses/${c.id}`}
                className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-[3px] focus-visible:after:ring-ring"
              >
                {c.title}
              </Link>
            </h2>
            <p className="truncate text-[13px] text-fg-muted">
              {c.subject.name}
              {c.teacher ? `, ${c.teacher.name}` : ""}
            </p>
          </div>
          {finished && <CircleCheck className="size-5 shrink-0 text-success" aria-label="Course finished" />}
        </div>
        {c.description && <p className="line-clamp-2 text-[13px] text-fg-secondary">{c.description}</p>}
        <div className="mt-auto flex flex-col gap-3">
          <ProgressBar
            value={c.completedCount}
            max={Math.max(1, c.lessonCount)}
            label="Progress"
            valueText={`${c.completedCount}/${c.lessonCount} lessons`}
            tone={finished ? "success" : "primary"}
            size="sm"
          />
          {!finished && c.nextLesson ? (
            // Straight to the lesson: the card's own overlay link covers the course page, so this sits above it.
            <Link
              href={`/student/courses/${c.id}/lessons/${c.nextLesson.id}`}
              className="relative z-10 flex items-center gap-1.5 text-[13px] font-medium text-brand hover:underline"
            >
              <span className="min-w-0 truncate">
                {c.completedCount ? "Continue" : "Start"}: {c.nextLesson.title}
              </span>
              <ArrowRight className="size-3.5 shrink-0" aria-hidden />
            </Link>
          ) : (
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-brand">
              {finished ? "Review the course" : "Open course"}
              <ArrowRight className="size-3.5 shrink-0" aria-hidden />
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
