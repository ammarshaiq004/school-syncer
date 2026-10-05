"use client";

import { useState } from "react";
import { CircleCheck, CircleHelp, CircleX, Timer, Users } from "lucide-react";
import {
  Alert,
  Avatar,
  Badge,
  BarChart,
  Button,
  Card,
  CardHeader,
  DataTable,
  Drawer,
  EmptyState,
  ErrorState,
  Input,
  KpiCard,
  NativeSelect,
  SkeletonRows,
  StatGrid,
  StatusPill,
  useToast,
  type Column,
} from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useApi } from "@/lib/use-api";
import { OUTCOME, pct, pts, QUESTION_KIND_LABEL, whenText, type AttemptDetail, type QuizResults } from "./assess-types";

type ResultRow = QuizResults["students"][number];

function rowStatus(r: ResultRow): { label: string; tone: "success" | "warning" | "info" | "neutral" } {
  if (r.needsReview) return { label: "Needs review", tone: "warning" };
  if (r.inProgress) return { label: "In progress", tone: "info" };
  if (r.submitted) return { label: "Submitted", tone: "success" };
  return { label: "Not started", tone: "neutral" };
}

/** Results tab: per-student scores, question breakdown and review of short answers. */
export function QuizResultsPanel({ quizId, onChanged }: { quizId: string; onChanged?: () => void }) {
  const { data, error, reload } = useApi<QuizResults>(`/elearning/quizzes/${quizId}/results`);
  const [open, setOpen] = useState<ResultRow | null>(null);

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <SkeletonRows rows={6} />;

  const s = data.summary;
  const columns: Column<ResultRow>[] = [
    {
      id: "roll",
      header: "Roll",
      width: "64px",
      align: "right",
      hideBelow: "sm",
      sortValue: (r) => r.student.rollNo ?? 9999,
      cell: (r) => r.student.rollNo ?? <span className="text-fg-muted">–</span>,
    },
    {
      id: "student",
      header: "Student",
      sortValue: (r) => r.student.name,
      cell: (r) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={r.student.name} src={r.student.photoUrl ?? undefined} size="sm" />
          <div className="min-w-0">
            <p className="truncate font-medium text-fg">{r.student.name}</p>
            <p className="truncate text-xs text-fg-muted">{r.student.admissionNo}</p>
          </div>
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      sortValue: (r) => rowStatus(r).label,
      cell: (r) => {
        const st = rowStatus(r);
        return <StatusPill status={st.label} tone={st.tone} label={st.label} />;
      },
    },
    { id: "attempts", header: "Attempts", align: "right", hideBelow: "md", sortValue: (r) => r.submitted, cell: (r) => r.submitted },
    {
      id: "best",
      header: "Best score",
      align: "right",
      sortValue: (r) => r.best?.percent ?? -1,
      cell: (r) =>
        r.best ? (
          <span>
            {pts(r.best.score)}/{pts(r.best.maxScore)} <span className="text-fg-muted">({pct(r.best.percent)})</span>
          </span>
        ) : (
          <span className="text-fg-muted">–</span>
        ),
    },
    {
      id: "latest",
      header: "Last submitted",
      hideBelow: "lg",
      sortValue: (r) => r.latest?.submittedAt ?? "",
      cell: (r) => (r.latest ? whenText(r.latest.submittedAt) : <span className="text-fg-muted">–</span>),
    },
    {
      id: "action",
      header: <span className="sr-only">Action</span>,
      width: "96px",
      align: "right",
      cell: (r) =>
        r.submitted ? (
          <Button size="sm" variant={r.needsReview ? "primary" : "secondary"} onClick={() => setOpen(r)} aria-label={`${r.needsReview ? "Review" : "View"} answers by ${r.student.name}`}>
            {r.needsReview ? "Review" : "View"}
          </Button>
        ) : null,
    },
  ];

  const stats = data.questionStats;
  return (
    <div className="flex flex-col gap-6">
      {!data.quiz.showResults && (
        <Alert tone="info">Students cannot see their scores for this quiz. Turn on Show score and answers in Settings to share them.</Alert>
      )}
      <StatGrid>
        <KpiCard label="Attempted" value={`${s.attempted}/${s.students}`} icon={<Users />} tone="primary" hint={`Out of ${pts(data.maxScore)} ${data.maxScore === 1 ? "point" : "points"}`} />
        <KpiCard label="Average best score" value={pct(s.avgPercent)} icon={<CircleCheck />} tone="success" hint="Students who submitted" />
        <KpiCard label="In progress" value={s.inProgress} icon={<Timer />} tone="info" hint="Started, not submitted" />
        <KpiCard label="Attempts to review" value={s.needsReview} icon={<CircleHelp />} tone={s.needsReview ? "warning" : "success"} hint={s.needsReview ? "Short answers waiting for you" : "Nothing to review"} />
      </StatGrid>

      <DataTable
        label="Quiz results"
        columns={columns}
        data={data.students}
        getRowId={(r) => r.student.id}
        getSearchText={(r) => `${r.student.name} ${r.student.admissionNo}`}
        searchPlaceholder="Search student or admission no."
        defaultSort={{ id: "roll", dir: "asc" }}
        pageSize={0}
        onRowClick={(r) => r.submitted > 0 && setOpen(r)}
        getRowLabel={(r) => r.student.name}
        empty={{ title: "No students in this section", description: "Enrol students in the section and they will appear here." }}
      />

      {stats.length > 0 && (
        <Card>
          <CardHeader title="Question breakdown" description="Share of submitted answers that earned full marks." />
          {stats.every((q) => q.answered === 0) ? (
            <EmptyState title="No answers yet" description="The breakdown appears once students submit." compact />
          ) : (
            <BarChart
              label="Percent of answers correct per question"
              categories={stats.map((_, i) => `Q${i + 1}`)}
              series={[{ name: "Correct", values: stats.map((q) => (q.answered ? Math.round((q.correct / q.answered) * 100) : 0)), color: "var(--chart-1)" }]}
              yMax={100}
              formatValue={(n) => `${n}%`}
              height={200}
            />
          )}
          <ol className="mt-4 divide-y divide-border border-t border-border">
            {stats.map((q, i) => (
              <li key={q.questionId} className="flex items-start gap-3 py-2.5 text-sm">
                <span className="w-8 shrink-0 font-semibold tabular-nums text-fg-muted">Q{i + 1}</span>
                <span className="min-w-0 flex-1 text-fg">
                  <span className="line-clamp-2">{q.prompt}</span>
                  <span className="text-xs text-fg-muted">{QUESTION_KIND_LABEL[q.kind]} · {q.points} {q.points === 1 ? "point" : "points"}</span>
                </span>
                <span className="shrink-0 text-end tabular-nums text-fg-secondary">
                  {q.correct}/{q.answered} correct
                  {q.pending > 0 && (
                    <Badge tone="warning" className="ms-2">
                      {q.pending} to review
                    </Badge>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <AttemptDrawer
        row={open}
        onClose={() => setOpen(null)}
        onReviewed={async () => {
          await reload();
          onChanged?.();
        }}
      />
    </div>
  );
}

function AttemptDrawer({ row, onClose, onReviewed }: { row: ResultRow | null; onClose: () => void; onReviewed: () => Promise<void> }) {
  const submitted = (row?.attemptList ?? []).filter((a) => a.submittedAt);
  // Default to the latest attempt that needs review, else the latest submitted one.
  const initial = submitted.find((a) => a.needsReview)?.id ?? submitted[submitted.length - 1]?.id ?? null;
  return (
    <Drawer
      open={!!row}
      onOpenChange={(o) => !o && onClose()}
      title={row?.student.name ?? "Attempt"}
      description={row ? `Adm. no. ${row.student.admissionNo}` : undefined}
      size="lg"
    >
      {row && initial && <AttemptPicker key={row.student.id} attempts={submitted} initial={initial} onReviewed={onReviewed} />}
    </Drawer>
  );
}

function AttemptPicker({ attempts, initial, onReviewed }: { attempts: ResultRow["attemptList"]; initial: string; onReviewed: () => Promise<void> }) {
  const [attemptId, setAttemptId] = useState(initial);
  return (
    <div className="flex flex-col gap-5">
      {attempts.length > 1 && (
        <NativeSelect
          aria-label="Attempt"
          value={attemptId}
          onChange={(e) => setAttemptId(e.target.value)}
          wrapperClassName="w-full sm:w-80"
          options={attempts.map((a, i) => ({
            value: a.id,
            label: `Attempt ${i + 1}: ${a.score != null ? `${pts(a.score)}/${pts(a.maxScore)}` : "not scored"}${a.needsReview ? ", needs review" : ""}`,
          }))}
        />
      )}
      <AttemptReview key={attemptId} attemptId={attemptId} onReviewed={onReviewed} />
    </div>
  );
}

function AttemptReview({ attemptId, onReviewed }: { attemptId: string; onReviewed: () => Promise<void> }) {
  const toast = useToast();
  const { data, error, reload } = useApi<AttemptDetail>(`/elearning/attempts/${attemptId}`);
  const [points, setPoints] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  if (error) return <ErrorState message={error} onRetry={reload} compact />;
  if (!data) return <SkeletonRows rows={5} />;

  const shortQs = data.questions.filter((q) => q.kind === "SHORT" && q.outcome !== "unanswered");
  const valueFor = (q: AttemptDetail["questions"][number]) => points[q.id] ?? String(q.reviewPoints ?? q.earned);

  async function saveReview() {
    if (!data) return;
    const pointsByQuestion: Record<string, number> = {};
    for (const q of shortQs) {
      const n = Number(valueFor(q));
      if (!Number.isFinite(n) || n < 0 || n > q.points) {
        toast.error("Check the points", `Question points must be from 0 to ${q.points}.`);
        return;
      }
      pointsByQuestion[q.id] = n;
    }
    setSaving(true);
    try {
      const updated = await api<AttemptDetail>(`/elearning/attempts/${attemptId}/review`, { method: "PUT", body: { pointsByQuestion } });
      toast.success("Review saved", `Score ${pts(updated.score ?? 0)}/${pts(updated.maxScore)}`);
      setPoints({});
      await reload();
      await onReviewed();
    } catch (e) {
      toast.error("Could not save review", (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg bg-surface-2 px-4 py-3 text-sm">
        <span>
          <span className="text-fg-muted">Score </span>
          <span className="font-semibold tabular-nums text-fg">
            {data.score != null ? `${pts(data.score)}/${pts(data.maxScore)}` : "Not scored"} ({pct(data.percent)})
          </span>
        </span>
        {data.submittedAt && <span className="text-fg-muted">Submitted {whenText(data.submittedAt)}</span>}
        {data.needsReview && <StatusPill status="review" tone="warning" label="Needs review" />}
      </div>

      <ol className="flex flex-col gap-3">
        {data.questions.map((q, i) => {
          const o = OUTCOME[q.outcome];
          const chosen = Array.isArray(q.answer) ? q.answer : [];
          const keys = q.correct.filter((c): c is number => typeof c === "number");
          const reviewable = q.kind === "SHORT" && q.outcome !== "unanswered";
          return (
            <li key={q.id} className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 flex-1 text-sm font-medium text-fg">
                  <span className="me-1.5 text-fg-muted tabular-nums">Q{i + 1}.</span>
                  {q.prompt}
                </p>
                <div className="flex items-center gap-2">
                  <StatusPill status={q.outcome} tone={o.tone} label={o.label} />
                  <span className="text-xs tabular-nums text-fg-muted">
                    {pts(q.earned)}/{q.points}
                  </span>
                </div>
              </div>
              {q.kind === "SHORT" ? (
                <div className="mt-3 grid gap-2 text-sm">
                  <p>
                    <span className="text-fg-muted">Answer: </span>
                    <span className="text-fg">{typeof q.answer === "string" && q.answer.trim() ? q.answer : "No answer"}</span>
                  </p>
                  <p className="text-[13px] text-fg-muted">Accepted: {q.correct.map(String).join(", ")}</p>
                  {reviewable && (
                    <label className="flex items-center gap-2 text-[13px] text-fg-secondary">
                      Award points
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={q.points}
                        step={0.5}
                        value={valueFor(q)}
                        onChange={(e) => setPoints((p) => ({ ...p, [q.id]: e.target.value }))}
                        className="h-8 w-20"
                        aria-label={`Points for question ${i + 1}, out of ${q.points}`}
                      />
                      <span className="tabular-nums">of {q.points}</span>
                    </label>
                  )}
                </div>
              ) : (
                <ul className="mt-3 grid gap-1.5">
                  {q.options.map((opt, oi) => {
                    const picked = chosen.includes(oi);
                    const right = keys.includes(oi);
                    return (
                      <li
                        key={oi}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm",
                          right ? "bg-success-tint text-success-text" : picked ? "bg-danger-tint text-danger-text" : "text-fg-secondary",
                        )}
                      >
                        {right ? <CircleCheck className="size-4 shrink-0" aria-hidden /> : picked ? <CircleX className="size-4 shrink-0" aria-hidden /> : <span className="size-4 shrink-0" aria-hidden />}
                        <span className="flex-1">{opt}</span>
                        <span className="text-xs">{[picked && "Chosen", right && "Correct"].filter(Boolean).join(", ")}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ol>

      {shortQs.length > 0 && (
        <div className="sticky bottom-0 flex justify-end border-t border-border bg-surface pt-4">
          <Button loading={saving} onClick={() => void saveReview()}>
            Save review
          </Button>
        </div>
      )}
    </div>
  );
}
