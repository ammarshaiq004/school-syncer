"use client";

import { useState, type FormEvent } from "react";
import { Alert, Button, Dialog, TextField, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { SectionSubjectFields, useSectionSubjectCourse } from "./assess-assignment-dialog";
import type { QuizDetail } from "./assess-types";

/** New quiz: pick the section and subject, then build questions on the quiz page. */
export function CreateQuizDialog({
  open,
  onOpenChange,
  defaultSectionId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultSectionId?: string;
  onCreated: (quiz: QuizDetail) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New quiz" description="Quizzes start as drafts. Add questions, then publish when it is ready." size="lg">
      {open && <CreateQuizForm defaultSectionId={defaultSectionId} onCancel={() => onOpenChange(false)} onCreated={onCreated} />}
    </Dialog>
  );
}

function CreateQuizForm({ defaultSectionId, onCancel, onCreated }: { defaultSectionId?: string; onCancel: () => void; onCreated: (q: QuizDetail) => void }) {
  const toast = useToast();
  const picks = useSectionSubjectCourse({ sectionId: defaultSectionId });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const limit = String(f.get("timeLimitMin") ?? "").trim();
    setSaving(true);
    setError("");
    try {
      const quiz = await api<QuizDetail>("/elearning/quizzes", {
        method: "POST",
        body: {
          sectionId: picks.sectionId,
          subjectId: picks.subjectId,
          courseId: picks.courseId || null,
          title: String(f.get("title") ?? "").trim(),
          timeLimitMin: limit ? Number(limit) : null,
        },
      });
      toast.success("Quiz created", "Add your questions next.");
      onCreated(quiz);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      {error && <Alert tone="danger">{error}</Alert>}
      <SectionSubjectFields state={picks} />
      <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
        <TextField name="title" label="Title" required minLength={2} maxLength={160} placeholder="Chapter 4 check: photosynthesis" />
        <TextField name="timeLimitMin" type="number" inputMode="numeric" label="Time limit (minutes)" min={1} max={300} step={1} placeholder="No limit" />
      </div>
      <p className="text-[13px] text-fg-muted">You can set the opening window, attempts and result settings on the quiz page.</p>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={saving} disabled={!picks.sectionId || !picks.subjectId}>
          Create and add questions
        </Button>
      </div>
    </form>
  );
}
