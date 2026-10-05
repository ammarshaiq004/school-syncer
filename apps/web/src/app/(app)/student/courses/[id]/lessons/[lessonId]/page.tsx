"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, CircleCheck, Clock, ExternalLink } from "lucide-react";
import { FileViewer } from "@/components/elearning/file-upload";
import { LESSON_KIND, shortDate } from "@/components/student-learning/format";
import { RichText } from "@/components/student-learning/rich-text";
import type { LessonCompleteResult, StudentCourseDetail, StudentLesson } from "@/components/student-learning/types";
import {
  Badge,
  Button,
  buttonClass,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  ProgressBar,
  Skeleton,
  SkeletonRows,
  useToast,
} from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useApi } from "@/lib/use-api";

/** Only these players are embedded; anything else opens in a new tab. */
const SAFE_EMBED = /^https:\/\/(www\.youtube-nocookie\.com\/embed\/|player\.vimeo\.com\/video\/)/;

/** Lesson player: video embed or reading, Mark complete, previous/next and the course outline. */
export default function StudentLessonPage() {
  const { id: courseId, lessonId } = useParams<{ id: string; lessonId: string }>();
  const lesson = useApi<StudentLesson>(`/student/lessons/${lessonId}`);
  const course = useApi<StudentCourseDetail>(`/student/courses/${courseId}`);
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<LessonCompleteResult | null>(null);
  const l = lesson.data;
  const completed = !!l && (l.completed || done?.lessonId === l.id);

  async function markComplete() {
    if (!l) return;
    setSaving(true);
    try {
      const res = await api<LessonCompleteResult>(`/student/lessons/${l.id}/complete`, { method: "POST" });
      setDone(res);
      toast.success("Lesson completed", `${res.percent}% of the course done`);
      void course.reload();
    } catch (e) {
      toast.error("Could not mark the lesson complete", (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (lesson.error && !l) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Lesson" breadcrumbs={[{ label: "Courses", href: "/student/courses" }, { label: "Lesson" }]} />
        <Card padding="none">
          {lesson.errorStatus === 404 ? (
            <EmptyState
              icon={<BookOpen />}
              title="This lesson is not available"
              description="It may have been unpublished by your teacher."
              action={<Link href={`/student/courses/${courseId}`} className={buttonClass("secondary", "sm")}>Back to the course</Link>}
            />
          ) : (
            <ErrorState message={lesson.error} onRetry={lesson.reload} />
          )}
        </Card>
      </div>
    );
  }

  const kind = l ? LESSON_KIND[l.kind] : null;
  const file = l?.file ?? null;
  const embed = !file && l?.embedUrl && SAFE_EMBED.test(l.embedUrl) ? l.embedUrl : null;
  const media = !!file || !!embed;
  const pct = done?.percent ?? course.data?.percent;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={l?.title ?? "Loading lesson"}
        breadcrumbs={[
          { label: "Courses", href: "/student/courses" },
          { label: l?.course.title ?? course.data?.title ?? "Course", href: `/student/courses/${courseId}` },
          { label: l?.title ?? "Lesson" },
        ]}
        meta={
          l &&
          kind && (
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral" icon={<kind.icon />}>
                {kind.label}
              </Badge>
              <span className="text-[13px] text-fg-muted">{l.unit.title}</span>
              {l.durationMin ? (
                <span className="inline-flex items-center gap-1 text-[13px] text-fg-muted">
                  <Clock className="size-3.5" aria-hidden />
                  {l.durationMin} min
                </span>
              ) : null}
              {completed && <Badge tone="success" icon={<CircleCheck />}>Completed</Badge>}
            </span>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <Card padding={media ? "none" : "lg"} className={cn(media && "overflow-hidden")}>
            {!l ? (
              <div className="flex flex-col gap-3">
                <Skeleton className="aspect-video w-full rounded-lg" />
              </div>
            ) : (
              <>
                {file && <FileViewer file={file} title={l.title} />}
                {embed && (
                  <div className="aspect-video w-full bg-surface-3">
                    <iframe
                      src={embed}
                      title={`Video: ${l.title}`}
                      className="size-full"
                      allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                      allowFullScreen
                      referrerPolicy="strict-origin-when-cross-origin"
                      sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
                      loading="lazy"
                    />
                  </div>
                )}
                <div className={cn("flex flex-col gap-4", media && "p-5", media && !l.body && !(l.url && !file) && "hidden")}>
                  {l.url && !embed && !file && (
                    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-4 sm:flex-row sm:items-center">
                      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-tint text-brand" aria-hidden>
                        {kind && <kind.icon className="size-5" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-fg">
                          {l.kind === "DOCUMENT" ? "Open the document" : l.kind === "VIDEO" ? "Watch the video" : "Open the resource"}
                        </p>
                        <p className="truncate text-[13px] text-fg-muted">{hostOf(l.url)}, opens in a new tab</p>
                      </div>
                      <a href={l.url} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm")}>
                        Open
                        <ExternalLink aria-hidden />
                      </a>
                    </div>
                  )}
                  {embed && l.url && (
                    <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex w-fit items-center gap-1.5 text-[13px] font-medium text-brand hover:underline">
                      Video not playing? Open it in a new tab
                      <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  )}
                  {l.body ? (
                    <RichText text={l.body} />
                  ) : !l.url && !file ? (
                    <p className="text-sm text-fg-muted">This lesson has no content yet.</p>
                  ) : null}
                </div>
              </>
            )}
          </Card>

          <Card padding="sm" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3 px-1">
              {completed ? (
                <>
                  <CircleCheck className="size-5 shrink-0 text-success" aria-hidden />
                  <p className="text-sm text-fg">
                    <span className="font-medium">Completed</span>
                    {(done?.completedAt ?? l?.completedAt) && (
                      <span className="text-fg-muted"> on {shortDate((done?.completedAt ?? l?.completedAt)!)}</span>
                    )}
                  </p>
                </>
              ) : (
                <p className="text-sm text-fg-secondary">Finished this lesson? Mark it complete to track your progress.</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!completed && (
                <Button type="button" icon={<CircleCheck />} loading={saving} disabled={!l} onClick={markComplete}>
                  Mark complete
                </Button>
              )}
            </div>
          </Card>

          <nav aria-label="Lesson navigation" className="grid gap-3 sm:grid-cols-2">
            {l?.prev ? (
              <PrevNext href={`/student/courses/${courseId}/lessons/${l.prev.id}`} dir="prev" title={l.prev.title} />
            ) : (
              <span className="hidden sm:block" />
            )}
            {l?.next && <PrevNext href={`/student/courses/${courseId}/lessons/${l.next.id}`} dir="next" title={l.next.title} />}
          </nav>
        </div>

        <Card padding="none" className="h-fit lg:sticky lg:top-20">
          <div className="border-b border-border p-4">
            <CardHeader title="Course outline" className="mb-3" />
            {pct == null ? (
              <Skeleton className="h-2 w-full" />
            ) : (
              <ProgressBar value={pct} label="Course progress" showValue tone={pct >= 100 ? "success" : "primary"} size="sm" />
            )}
          </div>
          {course.error ? (
            <ErrorState message={course.error} onRetry={course.reload} compact />
          ) : !course.data ? (
            <div className="p-4">
              <SkeletonRows rows={5} columns={1} />
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto py-2">
              {course.data.units.map((u) => (
                <div key={u.id} className="py-1">
                  <p className="px-4 py-1.5 text-xs font-medium uppercase tracking-wide text-fg-muted">{u.title}</p>
                  <ol>
                    {u.lessons.map((x) => {
                      const active = x.id === lessonId;
                      const isDone = x.completed || done?.lessonId === x.id;
                      return (
                        <li key={x.id}>
                          <Link
                            href={`/student/courses/${courseId}/lessons/${x.id}`}
                            aria-current={active ? "page" : undefined}
                            className={cn(
                              "flex items-center gap-2.5 px-4 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring",
                              active ? "bg-primary-tint font-medium text-brand" : "text-fg-secondary hover:bg-surface-2",
                            )}
                          >
                            {isDone ? (
                              <CircleCheck className="size-4 shrink-0 text-success" aria-label="Completed" />
                            ) : (
                              <span className="size-4 shrink-0 rounded-full border-2 border-border-strong" aria-hidden />
                            )}
                            <span className="min-w-0 truncate">{x.title}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function PrevNext({ href, dir, title }: { href: string; dir: "prev" | "next"; title: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 rounded-xl border border-border bg-surface p-4 shadow-card transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-raised focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
        dir === "next" && "sm:col-start-2 sm:flex-row-reverse sm:text-right",
      )}
    >
      {dir === "prev" ? <ArrowLeft className="size-4 shrink-0 text-fg-muted" aria-hidden /> : <ArrowRight className="size-4 shrink-0 text-fg-muted" aria-hidden />}
      <span className="min-w-0">
        <span className="block text-xs text-fg-muted">{dir === "prev" ? "Previous lesson" : "Next lesson"}</span>
        <span className="block truncate text-sm font-medium text-fg">{title}</span>
      </span>
    </Link>
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "External link";
  }
}
