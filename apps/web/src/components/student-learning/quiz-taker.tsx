"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert, CloudCheck, LoaderCircle, Send, Timer } from "lucide-react";
import { Alert, Badge, Button, Card, ConfirmDialog, Input, useToast } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { clockTime } from "@/components/student/live-widgets";
import type { Answer, AttemptPaper, AttemptResult, AutosaveResult, PaperQuestion } from "./types";

const SAVE_DELAY_MS = 700;
const RETRY_MS = 5000;

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: string } | { kind: "error"; message: string };

const isAnswered = (a: Answer | undefined) => (Array.isArray(a) ? a.length > 0 : !!a?.trim());

function mmss(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * The quiz-taking screen: one fieldset per question (native radios and checkboxes), a countdown
 * driven by the server clock, debounced autosave after every change, and a confirm before submitting.
 * When time runs out the attempt is handed in automatically.
 */
export function QuizTaker({ paper, onFinished }: { paper: AttemptPaper; onFinished: (result: AttemptResult) => void }) {
  const toast = useToast();
  const [answers, setAnswers] = useState<Record<string, Answer>>(paper.answers ?? {});
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [confirm, setConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const [deadline, setDeadline] = useState<number | null>(paper.deadline ? Date.parse(paper.deadline) : null);

  const answersRef = useRef(answers);
  const pending = useRef<Record<string, Answer>>({});
  const saveTimer = useRef<number | null>(null);
  const offset = useRef(0);
  const finished = useRef(false);
  const flushRef = useRef<() => void>(() => undefined);
  /** Auto-submit at the deadline is tried once; after a failure the student can press Submit. */
  const autoTried = useRef(false);

  const finish = useCallback(
    async (auto: boolean) => {
      if (finished.current) return;
      finished.current = true;
      setSubmitting(true);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      try {
        const result = await api<AttemptResult>(`/student/attempts/${paper.attemptId}/submit`, {
          method: "POST",
          body: { answers: answersRef.current },
        });
        if (auto) toast.info("Time is up", "Your quiz was handed in with your saved answers.");
        else toast.success("Quiz submitted", paper.quiz.title);
        onFinished(result);
      } catch (e) {
        finished.current = false;
        setSubmitting(false);
        toast.error("Could not submit the quiz", (e as Error).message);
      }
    },
    [paper.attemptId, paper.quiz.title, onFinished, toast],
  );

  /** The attempt was closed on the server (time up or submitted elsewhere): show the result. */
  const closedOnServer = useCallback(async () => {
    if (finished.current) return;
    finished.current = true;
    try {
      const view = await api<AttemptResult | AttemptPaper>(`/student/attempts/${paper.attemptId}`);
      if (view.status === "submitted") {
        toast.info("This attempt has been handed in");
        onFinished(view);
        return;
      }
    } catch {
      /* fall through to a manual submit */
    }
    finished.current = false;
    void finish(true);
  }, [paper.attemptId, onFinished, finish, toast]);

  const flush = useCallback(async () => {
    saveTimer.current = null;
    const batch = pending.current;
    if (!Object.keys(batch).length || finished.current) return;
    pending.current = {};
    setSave({ kind: "saving" });
    try {
      const res = await api<AutosaveResult>(`/student/attempts/${paper.attemptId}`, { method: "PUT", body: { answers: batch } });
      offset.current = Date.parse(res.serverNow) - Date.now();
      if (res.deadline) setDeadline(Date.parse(res.deadline));
      setSave({ kind: "saved", at: res.savedAt });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        void closedOnServer();
        return;
      }
      // Keep the unsaved answers (newer edits win) and try again shortly.
      pending.current = { ...batch, ...pending.current };
      setSave({ kind: "error", message: (e as Error).message });
      if (!saveTimer.current) saveTimer.current = window.setTimeout(() => flushRef.current(), RETRY_MS);
    }
  }, [paper.attemptId, closedOnServer]);

  function setAnswer(qid: string, value: Answer) {
    const next = { ...answersRef.current, [qid]: value };
    answersRef.current = next;
    setAnswers(next);
    pending.current[qid] = value;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
  }

  // Clock: sync to the server time once, tick every second, hand in automatically at the deadline.
  const finishRef = useRef(finish);
  const deadlineRef = useRef(deadline);
  useEffect(() => {
    finishRef.current = finish;
    deadlineRef.current = deadline;
    flushRef.current = () => void flush();
  }, [finish, deadline, flush]);
  useEffect(() => {
    offset.current = Date.parse(paper.serverNow) - Date.now();
    const tick = () => {
      const t = Date.now() + offset.current;
      setNow(t);
      const d = deadlineRef.current;
      if (d !== null && t >= d && !finished.current && !autoTried.current) {
        autoTried.current = true;
        void finishRef.current(true);
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [paper.serverNow]);

  // Save anything pending when leaving, and warn while a save is outstanding.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length && !finished.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      const left = pending.current;
      if (Object.keys(left).length && !finished.current) {
        void api(`/student/attempts/${paper.attemptId}`, { method: "PUT", body: { answers: left } }).catch(() => undefined);
      }
    };
  }, [paper.attemptId]);

  const total = paper.questions.length;
  const answered = paper.questions.filter((q) => isAnswered(answers[q.id])).length;
  const remaining = deadline !== null && now !== null ? deadline - now : null;
  const low = remaining !== null && remaining <= 60_000;
  const warnSoon = remaining !== null && remaining <= 5 * 60_000;

  return (
    <div className="flex flex-col gap-6">
      {/* Sticky status bar: timer, progress, save state, submit */}
      <div className="sticky top-[4.5rem] z-20">
        <Card padding="sm" className="flex flex-wrap items-center gap-x-4 gap-y-2 shadow-raised">
          {remaining !== null ? (
            <div
              className={cn(
                "inline-flex items-center gap-2 rounded-lg px-2.5 py-1 font-display text-lg font-semibold tabular-nums",
                low ? "bg-danger-tint text-danger-text" : warnSoon ? "bg-warning-tint text-warning-text" : "bg-surface-2 text-fg",
              )}
              role="timer"
              aria-label={`Time left ${mmss(remaining)}`}
            >
              <Timer className="size-4" aria-hidden />
              {mmss(remaining)}
            </div>
          ) : (
            <Badge tone="neutral" icon={<Timer />}>
              No time limit
            </Badge>
          )}
          <p className="text-sm text-fg-secondary tabular-nums">
            <span className="font-semibold text-fg">{answered}</span> of {total} answered
          </p>
          <SaveIndicator state={save} />
          <Button type="button" className="ms-auto" icon={<Send />} loading={submitting} onClick={() => setConfirm(true)}>
            Submit quiz
          </Button>
          <span className="sr-only" aria-live="polite">
            {remaining !== null && Math.ceil(remaining / 1000) === 300 ? "5 minutes left" : remaining !== null && Math.ceil(remaining / 1000) === 60 ? "1 minute left" : ""}
          </span>
        </Card>
      </div>

      {warnSoon && remaining !== null && remaining > 0 && (
        <Alert tone={low ? "danger" : "warning"}>
          {low ? "Less than a minute left." : "Less than 5 minutes left."} The quiz hands itself in when the timer reaches zero.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_14rem]">
        <ol className="flex min-w-0 flex-col gap-4">
          {paper.questions.map((q, i) => (
            <li key={q.id} id={`q-${q.id}`} className="scroll-mt-36">
              <QuestionCard question={q} index={i} total={total} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} disabled={submitting} />
            </li>
          ))}
        </ol>

        <nav aria-label="Questions" className="hidden h-fit lg:sticky lg:top-40 lg:block">
          <Card padding="sm">
            <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-fg-muted">Questions</p>
            <ul className="grid grid-cols-5 gap-1.5">
              {paper.questions.map((q, i) => {
                const done = isAnswered(answers[q.id]);
                return (
                  <li key={q.id}>
                    <a
                      href={`#q-${q.id}`}
                      aria-label={`Question ${i + 1}, ${done ? "answered" : "not answered"}`}
                      className={cn(
                        "grid h-8 place-items-center rounded-md border text-[13px] font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
                        done ? "border-primary bg-primary-tint text-brand" : "border-border text-fg-secondary hover:bg-surface-2",
                      )}
                    >
                      {i + 1}
                    </a>
                  </li>
                );
              })}
            </ul>
          </Card>
        </nav>
      </div>

      <div className="flex justify-end">
        <Button type="button" icon={<Send />} loading={submitting} onClick={() => setConfirm(true)}>
          Submit quiz
        </Button>
      </div>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Submit your quiz?"
        description={
          answered < total
            ? `You have answered ${answered} of ${total} questions. Unanswered questions get no marks. You cannot change your answers after submitting.`
            : "You have answered every question. You cannot change your answers after submitting."
        }
        confirmLabel="Submit quiz"
        loading={submitting}
        onConfirm={() => {
          setConfirm(false);
          void finish(false);
        }}
      />
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-fg-muted" aria-live="polite">
      {state.kind === "saving" ? (
        <>
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
          Saving
        </>
      ) : state.kind === "saved" ? (
        <>
          <CloudCheck className="size-3.5 text-success" aria-hidden />
          Saved at {clockTime(state.at)}
        </>
      ) : state.kind === "error" ? (
        <span className="inline-flex items-center gap-1.5 text-danger-text" title={state.message}>
          <CircleAlert className="size-3.5" aria-hidden />
          Not saved yet, retrying
        </span>
      ) : (
        "Answers save automatically"
      )}
    </span>
  );
}

function QuestionCard({
  question: q,
  index,
  total,
  value,
  onChange,
  disabled,
}: {
  question: PaperQuestion;
  index: number;
  total: number;
  value: Answer | undefined;
  onChange: (v: Answer) => void;
  disabled?: boolean;
}) {
  const promptId = `q-${q.id}-prompt`;
  const selected = Array.isArray(value) ? value : [];
  const multi = q.kind === "MULTI";
  const options = q.kind === "TRUE_FALSE" && q.options.length !== 2 ? ["True", "False"] : q.options;

  return (
    <Card>
      <fieldset className="flex flex-col gap-4" disabled={disabled}>
        <legend className="contents">
          <span className="flex items-center justify-between gap-3 text-xs font-medium text-fg-muted">
            <span>
              Question {index + 1} of {total}
            </span>
            <span className="tabular-nums">
              {q.points} {q.points === 1 ? "point" : "points"}
            </span>
          </span>
          <span id={promptId} className="mt-1 block whitespace-pre-line text-base font-medium text-fg">
            {q.prompt}
          </span>
          {multi && <span className="mt-1 block text-[13px] text-fg-muted">Select all that apply.</span>}
        </legend>

        {q.kind === "SHORT" ? (
          <Input
            aria-labelledby={promptId}
            placeholder="Type your answer"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            maxLength={500}
            autoComplete="off"
          />
        ) : (
          <div className={cn("grid gap-2", q.kind === "TRUE_FALSE" && "sm:grid-cols-2")}>
            {options.map((opt, i) => {
              const checked = selected.includes(i);
              return (
                <label
                  key={i}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 text-sm transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring",
                    checked ? "border-primary bg-primary-tint text-fg" : "border-border hover:border-border-strong hover:bg-surface-2",
                  )}
                >
                  <input
                    type={multi ? "checkbox" : "radio"}
                    name={`answer-${q.id}`}
                    className="mt-0.5 size-4 shrink-0 accent-[var(--primary)] focus-visible:outline-none"
                    checked={checked}
                    onChange={(e) => {
                      if (multi) onChange(e.target.checked ? [...selected, i].sort((a, b) => a - b) : selected.filter((x) => x !== i));
                      else onChange([i]);
                    }}
                  />
                  <span className="min-w-0 whitespace-pre-line">{opt}</span>
                </label>
              );
            })}
          </div>
        )}
      </fieldset>
    </Card>
  );
}
