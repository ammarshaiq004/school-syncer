"use client";

import { Check, CircleCheck, CircleDashed, CircleX, Hourglass, Lock } from "lucide-react";
import { Alert, Badge, Card, CardHeader, ProgressRing } from "@/components/ui";
import { cn } from "@/lib/cn";
import { dateTime, scoreTone } from "./format";
import type { AttemptResult, Outcome } from "./types";

const OUTCOME: Record<Outcome, { label: string; tone: "success" | "danger" | "neutral" | "warning" | "info"; icon: typeof Check }> = {
  correct: { label: "Correct", tone: "success", icon: CircleCheck },
  incorrect: { label: "Incorrect", tone: "danger", icon: CircleX },
  unanswered: { label: "Not answered", tone: "neutral", icon: CircleDashed },
  pending: { label: "Being marked", tone: "warning", icon: Hourglass },
  reviewed: { label: "Marked by teacher", tone: "info", icon: Check },
};

/** A submitted attempt: score, notes on timing and marking, and a question-by-question review when allowed. */
export function QuizResult({ result: r, actions }: { result: AttemptResult; actions?: React.ReactNode }) {
  const pct = r.percent == null ? null : Math.round(r.percent);
  return (
    <div className="flex flex-col gap-6">
      <Card padding="lg" className="animate-rise">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          {r.showResults && r.score != null && pct != null ? (
            <ProgressRing value={r.score} max={r.maxScore || 1} size={104} stroke={9} tone={scoreTone(pct)} label={`Score ${r.score} out of ${r.maxScore}`}>
              <span className="text-center leading-tight">
                <span className="block font-display text-2xl font-semibold tabular-nums text-fg">{pct}%</span>
                <span className="block text-xs tabular-nums text-fg-muted">
                  {r.score}/{r.maxScore}
                </span>
              </span>
            </ProgressRing>
          ) : (
            <span className="grid size-[104px] shrink-0 place-items-center rounded-full bg-success-tint text-success" aria-hidden>
              <CircleCheck className="size-10" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-fg">
              {!r.showResults
                ? "Quiz handed in"
                : pct == null
                  ? "Quiz handed in"
                  : pct >= 80
                    ? "Excellent work"
                    : pct >= 50
                      ? "Good effort"
                      : "Keep practising"}
            </h2>
            <p className="text-sm text-fg-secondary">Submitted {dateTime(r.submittedAt)}.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {r.timedOut && <Badge tone="warning">Handed in when time ran out</Badge>}
              {r.needsReview && <Badge tone="warning">Some answers are being marked</Badge>}
              {r.attemptsLeft > 0 && r.canRetry && <Badge tone="primary">{r.attemptsLeft} attempt{r.attemptsLeft === 1 ? "" : "s"} left</Badge>}
            </div>
          </div>
          {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
        </div>
      </Card>

      {!r.showResults && (
        <Alert tone="info" icon={<Lock />} title="Scores are hidden for now">
          Your teacher will share the results later.
        </Alert>
      )}
      {r.showResults && r.needsReview && (
        <Alert tone="warning" title="Your score may go up">
          Written answers that did not match exactly are waiting for your teacher to mark them. They count as zero until then.
        </Alert>
      )}
      {r.showResults && !r.answersVisible && (
        <Alert tone="neutral">Marks for each question and the correct answers are shown once you have used all your attempts or the quiz closes.</Alert>
      )}

      {r.questions && (
        <Card>
          <CardHeader
            title="Your answers"
            description={
              r.questions.some((q) => q.outcome)
                ? `${r.questions.filter((q) => q.outcome === "correct" || q.outcome === "reviewed").length} of ${r.questions.length} marked right`
                : undefined
            }
          />
          <ol className="flex flex-col divide-y divide-border">
            {r.questions.map((q, i) => {
              // Outcomes are left out while the student can still retry (so a retry cannot copy the marking).
              const o = q.outcome ? OUTCOME[q.outcome] : null;
              const chosen = Array.isArray(q.answer) ? q.answer : [];
              const keys = Array.isArray(q.correct) && q.kind !== "SHORT" ? (q.correct as number[]) : [];
              return (
                <li key={q.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 text-sm font-medium text-fg">
                      <span className="text-fg-muted">{i + 1}. </span>
                      <span className="whitespace-pre-line">{q.prompt}</span>
                    </p>
                    <span className="flex items-center gap-2">
                      {o && (
                        <Badge tone={o.tone} icon={<o.icon />}>
                          {o.label}
                        </Badge>
                      )}
                      <span className="text-[13px] tabular-nums text-fg-muted">
                        {o ? `${q.earned ?? 0}/${q.points}` : `${q.points} ${q.points === 1 ? "point" : "points"}`}
                      </span>
                    </span>
                  </div>
                  {q.kind === "SHORT" ? (
                    <div className="flex flex-col gap-1 text-sm">
                      <p>
                        <span className="text-fg-muted">Your answer: </span>
                        <span className="text-fg">{typeof q.answer === "string" && q.answer.trim() ? q.answer : "No answer"}</span>
                      </p>
                      {Array.isArray(q.correct) && q.correct.length > 0 && (
                        <p>
                          <span className="text-fg-muted">Accepted answers: </span>
                          <span className="font-medium text-success-text">{(q.correct as string[]).join(", ")}</span>
                        </p>
                      )}
                    </div>
                  ) : (
                    <ul className="grid gap-1.5">
                      {q.options.map((opt, j) => {
                        const mine = chosen.includes(j);
                        const right = keys.includes(j);
                        return (
                          <li
                            key={j}
                            className={cn(
                              "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm",
                              right ? "border-success/50 bg-success-tint" : mine && q.outcome === "incorrect" ? "border-danger/40 bg-danger-tint" : mine ? "border-primary bg-primary-tint" : "border-border",
                            )}
                          >
                            <span className="min-w-0 flex-1 whitespace-pre-line text-fg">{opt}</span>
                            {mine && <span className="text-xs font-medium text-fg-secondary">Your answer</span>}
                            {right && (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-success-text">
                                <Check className="size-3.5" aria-hidden />
                                Correct answer
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        </Card>
      )}
    </div>
  );
}
