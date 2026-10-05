"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, History, ListChecks, Play, Timer } from "lucide-react";
import { dateTime, plural, quizStatus, scoreTone } from "@/components/student-learning/format";
import { RichText } from "@/components/student-learning/rich-text";
import type { AttemptPaper, AttemptSummary, StudentQuizDetail } from "@/components/student-learning/types";
import {
  Alert,
  Badge,
  Button,
  buttonClass,
  Card,
  CardHeader,
  ConfirmDialog,
  DataTable,
  DescriptionList,
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonRows,
  StatusPill,
  useToast,
  type Column,
} from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";

/** A quiz before taking it: rules, Start or Resume, and earlier attempts with their scores. */
export default function StudentQuizPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { data: q, error, errorStatus, reload } = useApi<StudentQuizDetail>(`/student/quizzes/${id}`);
  const [confirm, setConfirm] = useState(false);
  const [starting, setStarting] = useState(false);

  async function start() {
    setStarting(true);
    try {
      const paper = await api<AttemptPaper>(`/student/quizzes/${id}/start`, { method: "POST" });
      router.push(`/student/quizzes/${id}/attempt/${paper.attemptId}`);
    } catch (e) {
      toast.error("Could not start the quiz", (e as Error).message);
      setStarting(false);
      setConfirm(false);
      void reload();
    }
  }

  if (error && !q) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Quiz" breadcrumbs={[{ label: "Quizzes", href: "/student/quizzes" }, { label: "Quiz" }]} />
        <Card padding="none">
          {errorStatus === 404 ? (
            <EmptyState
              icon={<ListChecks />}
              title="This quiz is not available"
              description="It may have been unpublished by your teacher."
              action={<Link href="/student/quizzes" className={buttonClass("secondary", "sm")}>Back to quizzes</Link>}
            />
          ) : (
            <ErrorState message={error} onRetry={reload} />
          )}
        </Card>
      </div>
    );
  }

  const s = q ? quizStatus(q) : null;
  const columns: Column<AttemptSummary>[] = [
    { id: "n", header: "Attempt", cell: (r) => `Attempt ${(q?.attempts.indexOf(r) ?? 0) + 1}`, width: "110px" },
    { id: "submitted", header: "Submitted", cell: (r) => <span className="tabular-nums">{dateTime(r.submittedAt)}</span>, hideBelow: "sm" },
    {
      id: "score",
      header: "Score",
      align: "right",
      cell: (r) =>
        r.score == null ? (
          <span className="text-fg-muted">Hidden</span>
        ) : (
          <span className="inline-flex items-center gap-2">
            {r.needsReview && <StatusPill status="REVIEW" label="Being marked" />}
            <span className="font-medium text-fg">
              {r.score}/{r.maxScore}
            </span>
            <Badge tone={scoreTone(r.percent)}>{Math.round(r.percent ?? 0)}%</Badge>
          </span>
        ),
    },
    {
      id: "open",
      header: <span className="sr-only">Open</span>,
      width: "110px",
      align: "right",
      cell: (r) => (
        <Link href={`/student/quizzes/${id}/attempt/${r.id}`} className="inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
          Review
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={q?.title ?? "Loading quiz"}
        description={q ? `${q.subject.name}${q.course && q.course.title !== q.subject.name ? `, ${q.course.title}` : ""}` : undefined}
        breadcrumbs={[{ label: "Quizzes", href: "/student/quizzes" }, { label: q?.title ?? "Quiz" }]}
        meta={s && <Badge tone={s.tone}>{s.label}</Badge>}
        actions={
          q?.inProgressAttemptId ? (
            <Link href={`/student/quizzes/${id}/attempt/${q.inProgressAttemptId}`} className={buttonClass("primary")}>
              <Play aria-hidden />
              Resume quiz
            </Link>
          ) : q?.canStart ? (
            <Button type="button" icon={<Play />} onClick={() => setConfirm(true)}>
              {q.submitted ? "Try again" : "Start quiz"}
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader icon={<ListChecks />} title="Before you start" />
            {!q ? (
              <SkeletonRows rows={4} columns={1} />
            ) : (
              <div className="flex flex-col gap-4">
                {q.instructions ? <RichText text={q.instructions} /> : <p className="text-sm text-fg-secondary">Read each question carefully and choose the best answer.</p>}
                <ul className="flex list-disc flex-col gap-1 ps-5 text-[13px] text-fg-secondary">
                  <li>Your answers are saved automatically each time you change one.</li>
                  {q.timeLimitMin ? (
                    <li>You have {q.timeLimitMin} minutes once you start. When time runs out, the quiz is handed in with your saved answers.</li>
                  ) : (
                    <li>There is no time limit, but hand it in before the quiz closes.</li>
                  )}
                  <li>
                    You can take it {plural(q.attemptsAllowed, "time")}.{q.attemptsUsed ? ` You have used ${q.attemptsUsed}.` : ""}
                  </li>
                </ul>
                {q.window === "upcoming" && q.opensAt && <Alert tone="info">This quiz opens on {dateTime(q.opensAt)}.</Alert>}
                {q.window === "closed" && !q.submitted && <Alert tone="neutral">This quiz has closed.</Alert>}
                {q.window === "open" && !q.canStart && q.attemptsLeft === 0 && <Alert tone="success">You have used all your attempts. Review your results below.</Alert>}
              </div>
            )}
          </Card>

          <section className="flex flex-col gap-3" aria-labelledby="attempts-heading">
            <h2 id="attempts-heading" className="flex items-center gap-2 text-lg font-semibold text-fg">
              <History className="size-5 text-brand" aria-hidden />
              Your attempts
            </h2>
            <DataTable
              label="Your attempts"
              columns={columns}
              data={q ? q.attempts : null}
              error={error}
              onRetry={reload}
              getRowId={(r) => r.id}
              onRowClick={(r) => router.push(`/student/quizzes/${id}/attempt/${r.id}`)}
              getRowLabel={(r) => `Attempt submitted ${dateTime(r.submittedAt)}`}
              pageSize={0}
              empty={{ title: "No attempts yet", description: "Your submitted attempts and scores appear here." }}
            />
          </section>
        </div>

        <Card className="h-fit">
          <CardHeader title="Quiz details" />
          {!q ? (
            <SkeletonRows rows={5} columns={1} />
          ) : (
            <DescriptionList
              columns={1}
              items={[
                { label: "Questions", value: `${q.questionCount} (${plural(q.totalPoints, "point")})` },
                {
                  label: "Time limit",
                  value: q.timeLimitMin ? (
                    <span className="inline-flex items-center gap-1">
                      <Timer className="size-3.5" aria-hidden />
                      {q.timeLimitMin} minutes
                    </span>
                  ) : (
                    "None"
                  ),
                },
                { label: "Opens", value: q.opensAt ? dateTime(q.opensAt) : "Now" },
                { label: "Closes", value: q.closesAt ? dateTime(q.closesAt) : "No closing date" },
                { label: "Attempts", value: `${q.attemptsUsed} of ${q.attemptsAllowed} used` },
                ...(q.best ? [{ label: "Best score", value: `${q.best.score}/${q.best.maxScore} (${Math.round(q.best.percent)}%)` }] : []),
              ]}
            />
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={q?.timeLimitMin ? `Start the timer for ${q.timeLimitMin} minutes?` : "Start this quiz?"}
        description={
          q?.timeLimitMin
            ? "The timer starts now and keeps running even if you close the page. Make sure you have time to finish."
            : "Your answers save as you go, so you can come back to it before it closes."
        }
        confirmLabel="Start now"
        loading={starting}
        onConfirm={start}
      />
    </div>
  );
}
