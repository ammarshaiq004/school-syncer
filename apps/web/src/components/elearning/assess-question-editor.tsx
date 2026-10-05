"use client";

import { useId, useState, type FormEvent } from "react";
import { CircleCheck, Plus, X } from "lucide-react";
import { Alert, Button, Checkbox, Dialog, IconButton, Input, SegmentedControl, TextareaField, TextField, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { QUESTION_KIND_LABEL, type Question, type QuestionKind } from "./assess-types";

const MAX_OPTIONS = 10;
const TRUE_FALSE = ["True", "False"];

export type QuestionTarget = { quizId: string; question?: Question; locked: boolean };

/** Add or edit one quiz question. When the quiz is locked (students have attempted it) only the wording can change. */
export function QuestionDialog({ target, onClose, onSaved }: { target: QuestionTarget | null; onClose: () => void; onSaved: () => Promise<unknown> | void }) {
  return (
    <Dialog
      open={!!target}
      onOpenChange={(o) => !o && onClose()}
      title={target?.question ? "Edit question" : "Add question"}
      description={target?.locked ? "Students have already attempted this quiz, so only the wording can change." : "Pick the question type, write the prompt and mark the correct answer."}
      size="lg"
    >
      {target && <QuestionForm key={target.question?.id ?? "new"} target={target} onCancel={onClose} onSaved={onSaved} />}
    </Dialog>
  );
}

interface Draft {
  kind: QuestionKind;
  prompt: string;
  points: string;
  options: string[];
  /** Correct option indexes (choice questions). */
  correct: number[];
  /** Accepted answers (SHORT). */
  accepted: string[];
}

function initialDraft(q?: Question): Draft {
  if (!q) return { kind: "SINGLE", prompt: "", points: "1", options: ["", "", "", ""], correct: [], accepted: [""] };
  const isShort = q.kind === "SHORT";
  return {
    kind: q.kind,
    prompt: q.prompt,
    points: String(q.points),
    options: isShort ? ["", ""] : q.kind === "TRUE_FALSE" ? TRUE_FALSE : [...q.options],
    correct: isShort ? [] : q.correct.filter((c): c is number => typeof c === "number"),
    accepted: isShort ? q.correct.map(String) : [""],
  };
}

/** Plain-English problem with the draft, mirroring the API rules, or null. */
function draftProblem(d: Draft): string | null {
  if (!d.prompt.trim()) return "Write the question.";
  const points = Number(d.points);
  if (!Number.isInteger(points) || points < 0 || points > 100) return "Points must be a whole number from 0 to 100.";
  if (d.kind === "SINGLE" || d.kind === "MULTI") {
    const opts = d.options.map((o) => o.trim());
    if (opts.some((o) => !o)) return "Fill in every option or remove the empty ones.";
    if (opts.length < 2) return "Add at least two options.";
    if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) return "Each option must be different.";
  }
  if ((d.kind === "SINGLE" || d.kind === "TRUE_FALSE") && d.correct.length !== 1) return "Mark the correct answer.";
  if (d.kind === "MULTI" && d.correct.length < 1) return "Mark at least one correct option.";
  if (d.kind === "SHORT" && !d.accepted.some((a) => a.trim())) return "Add at least one accepted answer.";
  return null;
}

function QuestionForm({ target, onCancel, onSaved }: { target: QuestionTarget; onCancel: () => void; onSaved: () => Promise<unknown> | void }) {
  const toast = useToast();
  const groupId = useId();
  const { question, locked, quizId } = target;
  const [d, setD] = useState<Draft>(() => initialDraft(question));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (patch: Partial<Draft>) => setD((prev) => ({ ...prev, ...patch }));

  function changeKind(kind: QuestionKind) {
    if (kind === d.kind) return;
    if (kind === "TRUE_FALSE") return set({ kind, options: TRUE_FALSE, correct: [] });
    if (kind === "SHORT") return set({ kind, correct: [] });
    const options = d.kind === "TRUE_FALSE" || d.kind === "SHORT" ? ["", "", "", ""] : d.options;
    // Going from multiple to single keeps only the first marked option.
    set({ kind, options, correct: kind === "SINGLE" ? d.correct.slice(0, 1) : d.correct });
  }

  function toggleCorrect(i: number) {
    if (d.kind === "MULTI") set({ correct: d.correct.includes(i) ? d.correct.filter((c) => c !== i) : [...d.correct, i].sort((a, b) => a - b) });
    else set({ correct: [i] });
  }

  function removeOption(i: number) {
    set({
      options: d.options.filter((_, j) => j !== i),
      correct: d.correct.filter((c) => c !== i).map((c) => (c > i ? c - 1 : c)),
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problem = locked ? (d.prompt.trim() ? null : "Write the question.") : draftProblem(d);
    if (problem) return setError(problem);
    const body = locked
      ? { prompt: d.prompt.trim() }
      : {
          kind: d.kind,
          prompt: d.prompt.trim(),
          points: Number(d.points),
          options: d.kind === "SINGLE" || d.kind === "MULTI" ? d.options.map((o) => o.trim()) : [],
          correct: d.kind === "SHORT" ? d.accepted.map((a) => a.trim()).filter(Boolean) : d.correct,
        };
    setSaving(true);
    setError("");
    try {
      if (question) await api(`/elearning/questions/${question.id}`, { method: "PATCH", body });
      else await api(`/elearning/quizzes/${quizId}/questions`, { method: "POST", body });
      toast.success(question ? "Question updated" : "Question added");
      await onSaved();
      onCancel();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const choice = d.kind !== "SHORT";
  const multi = d.kind === "MULTI";

  return (
    <form onSubmit={submit} className="grid gap-5">
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex flex-col gap-1.5">
        <span id={`${groupId}-kind`} className="text-sm font-medium text-fg">
          Question type
        </span>
        <SegmentedControl<QuestionKind>
          aria-label="Question type"
          size="md"
          value={d.kind}
          onChange={(k) => !locked && changeKind(k)}
          className={cn("w-fit max-w-full flex-wrap", locked && "pointer-events-none opacity-50")}
          options={(Object.keys(QUESTION_KIND_LABEL) as QuestionKind[]).map((k) => ({ value: k, label: QUESTION_KIND_LABEL[k] }))}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
        <TextareaField label="Question" required rows={3} maxLength={2000} value={d.prompt} onChange={(e) => set({ prompt: e.target.value })} placeholder="Which gas do plants take in during photosynthesis?" />
        <TextField label="Points" type="number" inputMode="numeric" min={0} max={100} step={1} required disabled={locked} value={d.points} onChange={(e) => set({ points: e.target.value })} />
      </div>

      {choice ? (
        <fieldset className="flex flex-col gap-2" disabled={locked}>
          <legend className="mb-1 text-sm font-medium text-fg">
            {d.kind === "TRUE_FALSE" ? "Correct answer" : multi ? "Options (tick every correct one)" : "Options (choose the correct one)"}
          </legend>
          <ul className="flex flex-col gap-2" role={multi ? undefined : "radiogroup"} aria-label={multi ? undefined : "Correct option"}>
            {d.options.map((opt, i) => {
              const isCorrect = d.correct.includes(i);
              const letter = String.fromCharCode(65 + i);
              return (
                <li key={i} className={cn("flex items-center gap-2 rounded-lg border p-1.5 ps-3 transition-colors", isCorrect ? "border-success bg-success-tint" : "border-border")}>
                  {multi ? (
                    <Checkbox checked={isCorrect} onCheckedChange={() => toggleCorrect(i)} disabled={locked} aria-label={`Option ${letter} is correct`} />
                  ) : (
                    <input
                      type="radio"
                      name={`${groupId}-correct`}
                      checked={isCorrect}
                      onChange={() => toggleCorrect(i)}
                      disabled={locked}
                      aria-label={d.kind === "TRUE_FALSE" ? `${opt} is correct` : `Option ${letter} is correct`}
                      className="size-4 shrink-0 accent-primary"
                    />
                  )}
                  <span className="w-5 shrink-0 text-xs font-semibold text-fg-muted" aria-hidden>
                    {letter}
                  </span>
                  {d.kind === "TRUE_FALSE" ? (
                    <span className="flex-1 py-1.5 text-sm text-fg">{opt}</span>
                  ) : (
                    <Input
                      value={opt}
                      maxLength={500}
                      onChange={(e) => set({ options: d.options.map((o, j) => (j === i ? e.target.value : o)) })}
                      placeholder={`Option ${letter}`}
                      aria-label={`Option ${letter}`}
                      className="h-8 flex-1 border-transparent bg-transparent shadow-none"
                    />
                  )}
                  {isCorrect && <CircleCheck className="size-4 shrink-0 text-success" aria-label="Correct" />}
                  {d.kind !== "TRUE_FALSE" && (
                    <IconButton size="sm" aria-label={`Remove option ${letter}`} disabled={locked || d.options.length <= 2} onClick={() => removeOption(i)}>
                      <X />
                    </IconButton>
                  )}
                </li>
              );
            })}
          </ul>
          {d.kind !== "TRUE_FALSE" && !locked && (
            <Button type="button" size="sm" variant="ghost" icon={<Plus />} className="w-fit" disabled={d.options.length >= MAX_OPTIONS} onClick={() => set({ options: [...d.options, ""] })}>
              Add option
            </Button>
          )}
          {multi && <p className="text-[13px] text-fg-muted">Students must tick every correct option, and no wrong ones, to get the points.</p>}
        </fieldset>
      ) : (
        <fieldset className="flex flex-col gap-2" disabled={locked}>
          <legend className="mb-1 text-sm font-medium text-fg">Accepted answers</legend>
          <ul className="flex flex-col gap-2">
            {d.accepted.map((a, i) => (
              <li key={i} className="flex items-center gap-2">
                <Input
                  value={a}
                  maxLength={200}
                  onChange={(e) => set({ accepted: d.accepted.map((x, j) => (j === i ? e.target.value : x)) })}
                  placeholder={i === 0 ? "carbon dioxide" : "Another accepted spelling, e.g. CO2"}
                  aria-label={`Accepted answer ${i + 1}`}
                  className="h-9 flex-1"
                />
                <IconButton size="sm" aria-label={`Remove accepted answer ${i + 1}`} disabled={locked || d.accepted.length <= 1} onClick={() => set({ accepted: d.accepted.filter((_, j) => j !== i) })}>
                  <X />
                </IconButton>
              </li>
            ))}
          </ul>
          {!locked && (
            <Button type="button" size="sm" variant="ghost" icon={<Plus />} className="w-fit" disabled={d.accepted.length >= 20} onClick={() => set({ accepted: [...d.accepted, ""] })}>
              Add accepted answer
            </Button>
          )}
          <p className="text-[13px] text-fg-muted">Matching ignores capital letters and extra spaces. Any other answer is left for you to review and award points.</p>
        </fieldset>
      )}

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          {question ? "Save question" : "Add question"}
        </Button>
      </div>
    </form>
  );
}
