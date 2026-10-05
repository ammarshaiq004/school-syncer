"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, ExternalLink, FileText, RotateCcw } from "lucide-react";
import { Alert, Avatar, Badge, Button, DescriptionList, Drawer, EmptyState, StatusPill, TextareaField, TextField, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { FileChip, FileViewer } from "./file-upload";
import { WORK_STATE, whenText, type Assignment, type Submission, type SubmissionRow } from "./assess-types";

/**
 * Side panel for one student's work on an assignment: the submitted text and link,
 * then points and feedback. "Save grade" marks it GRADED (final); "Return to redo"
 * sends it back so the student can hand in again.
 */
export function GradeDrawer({
  assignment,
  row,
  hasNext,
  onClose,
  onSaved,
  onNext,
}: {
  assignment: Assignment;
  row: SubmissionRow | null;
  hasNext: boolean;
  onClose: () => void;
  onSaved: () => Promise<unknown> | void;
  onNext: () => void;
}) {
  return (
    <Drawer
      open={!!row}
      onOpenChange={(o) => !o && onClose()}
      title={row?.student.name ?? "Submission"}
      description={row ? `Adm. no. ${row.student.admissionNo}${row.student.rollNo != null ? ` · Roll ${row.student.rollNo}` : ""}` : undefined}
      headerExtra={row && <StatusPill status={row.state} tone={WORK_STATE[row.state].tone} label={WORK_STATE[row.state].label} />}
      size="lg"
    >
      {row && <GradePanel key={`${row.student.id}-${row.submission?.id ?? "none"}-${row.submission?.submittedAt ?? ""}`} assignment={assignment} row={row} hasNext={hasNext} onSaved={onSaved} onNext={onNext} />}
    </Drawer>
  );
}

function GradePanel({
  assignment,
  row,
  hasNext,
  onSaved,
  onNext,
}: {
  assignment: Assignment;
  row: SubmissionRow;
  hasNext: boolean;
  onSaved: () => Promise<unknown> | void;
  onNext: () => void;
}) {
  const toast = useToast();
  const sub = row.submission;
  const [points, setPoints] = useState(sub?.points != null ? String(sub.points) : "");
  const [feedback, setFeedback] = useState(sub?.feedback ?? "");
  const [saving, setSaving] = useState<"GRADED" | "RETURNED" | null>(null);
  const [error, setError] = useState("");

  if (!sub) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Avatar name={row.student.name} src={row.student.photoUrl ?? undefined} size="md" />
          <p className="text-sm text-fg-secondary">
            Due {whenText(assignment.dueAt)}
            {assignment.allowLate ? ". Late work is still accepted." : ". Late work is not accepted."}
          </p>
        </div>
        <EmptyState icon={<FileText />} title="Nothing handed in yet" description="You can grade this once the student submits their work." compact />
        {hasNext && (
          <div className="flex justify-end">
            <Button variant="secondary" iconRight={<ArrowRight />} onClick={onNext}>
              Next student
            </Button>
          </div>
        )}
      </div>
    );
  }

  async function save(status: "GRADED" | "RETURNED", andNext: boolean) {
    const n = Number(points);
    if (points.trim() === "" || !Number.isInteger(n) || n < 0 || n > assignment.maxPoints) {
      setError(`Enter whole points from 0 to ${assignment.maxPoints}.`);
      return;
    }
    setSaving(status);
    setError("");
    try {
      await api<Submission>(`/elearning/submissions/${sub!.id}/grade`, { method: "PUT", body: { points: n, feedback: feedback.trim() || null, status } });
      toast.success(status === "GRADED" ? "Grade saved" : "Returned to the student", `${row.student.name}: ${n}/${assignment.maxPoints}`);
      await onSaved();
      if (andNext && hasNext) onNext();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(null);
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void save("GRADED", true);
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <DescriptionList
        columns={2}
        items={[
          {
            label: "Handed in",
            value: (
              <span className="inline-flex flex-wrap items-center gap-2">
                {whenText(sub.submittedAt)}
                {sub.isLate && <Badge tone="danger">Late</Badge>}
              </span>
            ),
          },
          {
            label: "Grade",
            value: sub.points != null ? `${sub.points}/${assignment.maxPoints}${sub.gradedBy ? ` by ${sub.gradedBy.name}` : ""}` : "Not graded yet",
          },
        ]}
      />

      <section aria-label="Submitted work" className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-fg">Submitted work</h3>
        {sub.body ? (
          <div className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-2 p-4 text-sm leading-relaxed text-fg">{sub.body}</div>
        ) : (
          <p className="text-sm text-fg-muted">No written answer.</p>
        )}
        {sub.file &&
          (sub.file.kind === "image" ? (
            <div className="overflow-hidden rounded-lg border border-border">
              <FileViewer file={sub.file} title={`Work handed in: ${sub.file.filename}`} />
              <FileChip file={sub.file} className="rounded-none border-0 border-t" />
            </div>
          ) : (
            <FileChip file={sub.file} />
          ))}
        {sub.linkUrl && (
          <a
            href={sub.linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit max-w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-brand hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
          >
            <ExternalLink className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{sub.linkUrl}</span>
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
      </section>

      {sub.status === "GRADED" && (
        <Alert tone="info">This work is graded and the student can no longer change it. You can still adjust the points or feedback.</Alert>
      )}
      {sub.status === "RETURNED" && <Alert tone="info">Returned to the student. When they hand in again it comes back here to grade.</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}

      <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
        <TextField
          label={`Points out of ${assignment.maxPoints}`}
          type="number"
          inputMode="numeric"
          min={0}
          max={assignment.maxPoints}
          step={1}
          required
          value={points}
          onChange={(e) => setPoints(e.target.value)}
        />
        <TextareaField
          label="Feedback for the student"
          rows={4}
          maxLength={5000}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="Good method in question 3. Check your signs in questions 6 and 7."
        />
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="secondary" icon={<RotateCcw />} loading={saving === "RETURNED"} disabled={!!saving} onClick={() => void save("RETURNED", false)}>
          Return to redo
        </Button>
        <Button type="button" variant="secondary" loading={saving === "GRADED"} disabled={!!saving} onClick={() => void save("GRADED", false)}>
          Save grade
        </Button>
        {hasNext && (
          <Button type="submit" iconRight={<ArrowRight />} disabled={!!saving}>
            Save and next
          </Button>
        )}
      </div>
    </form>
  );
}
