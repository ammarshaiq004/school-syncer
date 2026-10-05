"use client";

import { useState, type FormEvent } from "react";
import { Alert, Button, Card, CardHeader, SelectField, Switch, TextareaField, TextField, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import type { CourseSummary } from "./courses-types";
import { fromLocalInput, toLocalInput, type QuizDetail } from "./assess-types";

/** Quiz settings: title, instructions, time limit, opening window, attempts, shuffle, results and course link. */
export function QuizSettingsPanel({ quiz, onSaved }: { quiz: QuizDetail; onSaved: () => Promise<unknown> | void }) {
  const toast = useToast();
  const courses = useApi<CourseSummary[]>(`/elearning/courses?sectionId=${quiz.sectionId}&subjectId=${quiz.subjectId}`);
  const [shuffle, setShuffle] = useState(quiz.shuffleQuestions);
  const [showResults, setShowResults] = useState(quiz.showResults);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const manage = quiz.canManage;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const text = (k: string) => String(f.get(k) ?? "").trim();
    const opensAt = fromLocalInput(text("opensAt"));
    const closesAt = fromLocalInput(text("closesAt"));
    if (opensAt && closesAt && closesAt <= opensAt) return setError("The closing time must be after the opening time.");
    const limit = text("timeLimitMin");
    setSaving(true);
    setError("");
    try {
      await api(`/elearning/quizzes/${quiz.id}`, {
        method: "PATCH",
        body: {
          title: text("title"),
          instructions: text("instructions") || null,
          timeLimitMin: limit ? Number(limit) : null,
          opensAt,
          closesAt,
          attemptsAllowed: Number(text("attemptsAllowed")) || 1,
          shuffleQuestions: shuffle,
          showResults,
          courseId: text("courseId") || null,
        },
      });
      toast.success("Quiz settings saved");
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const courseOptions = (courses.data ?? []).filter((c) => c.sectionId === quiz.sectionId && c.subjectId === quiz.subjectId);

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-3">
      <fieldset disabled={!manage} className="flex min-w-0 flex-col gap-6 lg:col-span-2">
        <Card>
          <CardHeader title="Details" description="What students see before they start." />
          <div className="grid gap-4">
            {error && <Alert tone="danger">{error}</Alert>}
            <TextField name="title" label="Title" required minLength={2} maxLength={160} defaultValue={quiz.title} />
            <TextareaField
              name="instructions"
              label="Instructions"
              rows={4}
              maxLength={5000}
              defaultValue={quiz.instructions ?? ""}
              placeholder="Answer every question. You have one attempt and the timer starts when you press Start."
            />
            <SelectField
              name="courseId"
              label="Course (optional)"
              defaultValue={quiz.courseId ?? ""}
              key={courses.data ? "loaded" : "loading"}
              placeholder={courses.data && courseOptions.length === 0 ? "No course for this subject yet" : "Not linked"}
              options={courseOptions.map((c) => ({ value: c.id, label: c.title }))}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="Timing and attempts" description="All times are Pakistan time. Leave a field blank for no limit." />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="opensAt" type="datetime-local" label="Opens" defaultValue={toLocalInput(quiz.opensAt)} hint="Blank opens it as soon as it is published" />
            <TextField name="closesAt" type="datetime-local" label="Closes" defaultValue={toLocalInput(quiz.closesAt)} hint="Blank keeps it open" />
            <TextField name="timeLimitMin" type="number" inputMode="numeric" label="Time limit (minutes)" min={1} max={300} step={1} defaultValue={quiz.timeLimitMin ?? ""} placeholder="No limit" hint="Answers are submitted automatically when time runs out" />
            <TextField name="attemptsAllowed" type="number" inputMode="numeric" label="Attempts allowed" min={1} max={20} step={1} required defaultValue={quiz.attemptsAllowed} hint="Best score counts" />
          </div>
        </Card>
      </fieldset>
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader title="Options" />
          <div className="flex flex-col gap-4">
            <Switch checked={shuffle} onCheckedChange={setShuffle} disabled={!manage} label="Shuffle question order for each student" />
            <Switch checked={showResults} onCheckedChange={setShowResults} disabled={!manage} label="Show score and answers after submitting" />
            <p className="text-[13px] text-fg-muted">
              With results on, students see their score straight away. Correct answers are shown once they have no attempts left or the quiz has closed.
            </p>
          </div>
        </Card>
        {manage && (
          <div className="flex justify-end">
            <Button type="submit" loading={saving}>
              Save settings
            </Button>
          </div>
        )}
      </div>
    </form>
  );
}
