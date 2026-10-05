"use client";

import { BookOpenCheck, Check, CircleCheck, TriangleAlert, Users } from "lucide-react";
import { Avatar, Card, EmptyState, ErrorState, KpiCard, ProgressBar, SkeletonRows, StatGrid, Tooltip } from "@/components/ui";
import { day } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { LESSON_KIND_ICON } from "./courses-lesson-dialog";
import type { CourseProgress } from "./courses-types";

/** Students x lessons completion matrix for one course (published lessons only). */
export function CourseProgressPanel({ courseId }: { courseId: string }) {
  const { data, error, reload } = useApi<CourseProgress>(`/elearning/courses/${courseId}/progress`);

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <SkeletonRows rows={6} />;

  const lessons = data.lessons.filter((l) => l.isPublished);
  const finished = data.students.filter((s) => lessons.length > 0 && s.percent >= 100).length;
  const notStarted = data.students.filter((s) => s.completedCount === 0).length;

  return (
    <div className="flex flex-col gap-6">
      <StatGrid>
        <KpiCard label="Average completion" value={`${Math.round(data.avgPercent)}%`} icon={<BookOpenCheck />} />
        <KpiCard label="Published lessons" value={data.publishedLessonCount} icon={<CircleCheck />} tone="info" hint={`${data.lessons.length} in total`} />
        <KpiCard label="Finished the course" value={finished} icon={<Users />} tone="success" hint={`of ${data.students.length} students`} />
        <KpiCard label="Not started" value={notStarted} icon={<TriangleAlert />} tone="warning" />
      </StatGrid>
      {data.students.length === 0 ? (
        <Card padding="none">
          <EmptyState title="No students in this section" description="Students enrolled in the section show up here with their lesson progress." />
        </Card>
      ) : lessons.length === 0 ? (
        <Card padding="none">
          <EmptyState title="No published lessons yet" description="Publish a lesson in the Content tab and student progress will appear here." />
        </Card>
      ) : (
        <Card padding="none" className="overflow-hidden">
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <caption className="sr-only">Lesson completion by student</caption>
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 top-0 z-20 min-w-56 border-b border-border bg-surface-2 px-4 py-2.5 text-left text-xs font-medium uppercase tracking-[0.04em] text-fg-muted">
                    Student
                  </th>
                  <th scope="col" className="sticky top-0 z-10 min-w-40 border-b border-border bg-surface-2 px-3 py-2.5 text-left text-xs font-medium uppercase tracking-[0.04em] text-fg-muted">
                    Progress
                  </th>
                  {lessons.map((l, i) => {
                    const Icon = LESSON_KIND_ICON[l.kind];
                    return (
                      <th key={l.id} scope="col" className="sticky top-0 z-10 border-b border-s border-border bg-surface-2 px-1 py-2.5 text-center text-xs font-medium text-fg-muted">
                        <Tooltip content={`${l.unitTitle}: ${l.title}`}>
                          <span tabIndex={0} className="inline-flex flex-col items-center gap-0.5 rounded focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring" aria-label={`Lesson ${i + 1}: ${l.title}`}>
                            <Icon className="size-3.5" aria-hidden />
                            <span className="tabular-nums">{i + 1}</span>
                          </span>
                        </Tooltip>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {data.students.map((s) => (
                  <tr key={s.id} className="even:bg-surface-2/60 hover:bg-surface-3/60">
                    <th scope="row" className="sticky left-0 z-10 border-b border-border bg-surface px-4 py-2 text-left font-normal">
                      <span className="flex items-center gap-2.5">
                        <Avatar name={s.name} size="xs" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-fg">{s.name}</span>
                          <span className="block text-xs text-fg-muted">
                            {s.rollNo != null ? `Roll ${s.rollNo} · ` : ""}
                            {s.admissionNo}
                          </span>
                        </span>
                      </span>
                    </th>
                    <td className="border-b border-border px-3 py-2">
                      <ProgressBar value={s.percent} size="sm" label={<span className="tabular-nums">{Math.round(s.percent)}%</span>} valueText={`${s.completedCount}/${lessons.length} lessons`} tone={s.percent >= 100 ? "success" : s.percent === 0 ? "warning" : "primary"} />
                    </td>
                    {lessons.map((l) => {
                      const at = s.completed[l.id];
                      return (
                        <td key={l.id} className="border-b border-s border-border px-1 py-2 text-center">
                          {at ? (
                            <span title={`Completed ${day(at)}`} className="inline-flex size-6 items-center justify-center rounded-full bg-success-tint text-success">
                              <Check className="size-3.5" aria-hidden />
                              <span className="sr-only">Completed {day(at)}</span>
                            </span>
                          ) : (
                            <span className="inline-flex size-6 items-center justify-center text-fg-disabled">
                              <span aria-hidden className="size-1.5 rounded-full bg-surface-3" />
                              <span className="sr-only">Not completed</span>
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
