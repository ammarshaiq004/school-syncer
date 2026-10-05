"use client";

import Link from "next/link";
import { ArrowRight, CircleCheck, ListChecks, Timer, Trophy } from "lucide-react";
import { dateTime, plural, quizStatus, scoreTone } from "@/components/student-learning/format";
import type { StudentQuizCard } from "@/components/student-learning/types";
import { Badge, Card, EmptyState, ErrorState, KpiCard, PageHeader, Section, SkeletonCards, StatGrid } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useApi } from "@/lib/use-api";

/** Student quizzes: open now, coming up and finished, with best scores. */
export default function StudentQuizzesPage() {
  const { data, error, reload } = useApi<StudentQuizCard[]>("/student/quizzes");
  const open = data?.filter((q) => q.window === "open" && (q.canStart || q.inProgressAttemptId)) ?? [];
  const upcoming = data?.filter((q) => q.window === "upcoming") ?? [];
  const done = data?.filter((q) => !open.includes(q) && !upcoming.includes(q)) ?? [];
  const scored = data?.filter((q) => q.best) ?? [];
  const avg = scored.length ? Math.round(scored.reduce((n, q) => n + q.best!.percent, 0) / scored.length) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Quizzes"
        description="Short online tests from your teachers. Your answers save as you go."
        breadcrumbs={[{ label: "Student Workspace", href: "/student" }, { label: "Quizzes" }]}
      />

      {error && !data ? (
        <Card padding="none">
          <ErrorState message={error} onRetry={reload} />
        </Card>
      ) : !data ? (
        <>
          <SkeletonCards count={3} />
          <SkeletonCards count={3} className="xl:grid-cols-3" />
        </>
      ) : data.length === 0 ? (
        <Card padding="none">
          <EmptyState icon={<ListChecks />} title="No quizzes yet" description="When a teacher publishes a quiz for your class, it appears here." />
        </Card>
      ) : (
        <>
          <StatGrid cols={3}>
            <KpiCard label="Open now" value={open.length} icon={<ListChecks />} tone={open.length ? "primary" : "neutral"} hint={open.length ? "Ready to take" : "Nothing to take right now"} />
            <KpiCard label="Completed" value={data.filter((q) => q.submitted > 0).length} icon={<CircleCheck />} tone="success" />
            <KpiCard
              label="Average best score"
              value={avg == null ? "None yet" : `${avg}%`}
              icon={<Trophy />}
              tone={avg == null ? "neutral" : scoreTone(avg)}
              hint={scored.length ? `Across ${plural(scored.length, "quiz", "quizzes")}` : undefined}
            />
          </StatGrid>
          <QuizGroup title="Open now" quizzes={open} empty="No quizzes are open right now." />
          {upcoming.length > 0 && <QuizGroup title="Coming up" quizzes={upcoming} />}
          {done.length > 0 && <QuizGroup title="Finished and closed" quizzes={done} />}
        </>
      )}
    </div>
  );
}

function QuizGroup({ title, quizzes, empty }: { title: string; quizzes: StudentQuizCard[]; empty?: string }) {
  return (
    <Section title={title}>
      {quizzes.length === 0 ? (
        <Card padding="none">
          <EmptyState icon={<ListChecks />} title={empty ?? "Nothing here"} compact />
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {quizzes.map((q) => (
            <li key={q.id}>
              <QuizCardView quiz={q} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function QuizCardView({ quiz: q }: { quiz: StudentQuizCard }) {
  const s = quizStatus(q);
  const action = q.inProgressAttemptId ? "Resume" : q.canStart ? (q.submitted ? "Try again" : "Start quiz") : q.submitted ? "See results" : "View details";
  return (
    <Card interactive className="relative flex h-full flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-brand">{q.subject.name}</p>
          <h3 className="text-base font-semibold text-fg">
            <Link
              href={`/student/quizzes/${q.id}`}
              className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-[3px] focus-visible:after:ring-ring"
            >
              {q.title}
            </Link>
          </h3>
        </div>
        <Badge tone={s.tone}>{s.label}</Badge>
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg-muted">
        <span>{plural(q.questionCount, "question")}</span>
        <span>{plural(q.totalPoints, "point")}</span>
        {q.timeLimitMin ? (
          <span className="inline-flex items-center gap-1">
            <Timer className="size-3.5" aria-hidden />
            {q.timeLimitMin} min
          </span>
        ) : (
          <span>No time limit</span>
        )}
      </p>
      <p className="text-[13px] text-fg-secondary">
        {q.window === "upcoming" && q.opensAt
          ? `Opens ${dateTime(q.opensAt)}`
          : q.window === "open" && q.closesAt
            ? `Closes ${dateTime(q.closesAt)}`
            : q.window === "closed" && q.closesAt
              ? `Closed ${dateTime(q.closesAt)}`
              : "Open with no closing date"}
      </p>
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-3">
        {q.best ? (
          <span className="text-sm">
            <span className="text-fg-muted">Best </span>
            <span className={cn("font-semibold tabular-nums", q.best.percent >= 50 ? "text-fg" : "text-danger-text")}>
              {q.best.score}/{q.best.maxScore}
            </span>
            <span className="text-fg-muted tabular-nums"> ({Math.round(q.best.percent)}%)</span>
          </span>
        ) : q.submitted && !q.showResults ? (
          <span className="text-[13px] text-fg-muted">Score hidden by your teacher</span>
        ) : (
          <span className="text-[13px] text-fg-muted tabular-nums">
            {q.attemptsUsed}/{q.attemptsAllowed} attempts used
          </span>
        )}
        <span className="inline-flex items-center gap-1 text-[13px] font-medium text-brand">
          {action}
          <ArrowRight className="size-3.5" aria-hidden />
        </span>
      </div>
    </Card>
  );
}
