"use client";

import { useState, type FormEvent } from "react";
import { CircleCheck, MessageSquareWarning, Save, Send, Trash2 } from "lucide-react";
import { Alert, Badge, Button, ConfirmDialog, DescriptionList, Drawer, SelectField, TextareaField, TextField, useToast } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { mondayOf, STATUS_META, weekLabel, when, type LessonPlan, type PlanSection } from "./lesson-plan-types";

export interface PlanDraftDefaults {
  sectionId: string;
  subjectId: string;
  weekStart: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The plan to view or edit; null starts a new plan from `defaults`. */
  plan: LessonPlan | null;
  defaults: PlanDraftDefaults;
  sections: PlanSection[];
  /** The user can create and edit plans (lesson_plans manage, plan not read-only). */
  canManage: boolean;
  /** The user may approve or send back submitted plans (setup roles). */
  canReview: boolean;
  onChanged: (plan: LessonPlan | null) => void;
}

type Busy = "save" | "submit" | "delete" | "approve" | "changes" | null;

/** The only subject of a section, or the first one this user teaches there ("" when neither). */
function defaultSubject(sections: Props["sections"], sectionId: string): string {
  const opts = sections.find((s) => s.id === sectionId)?.subjects ?? [];
  return opts.length === 1 ? opts[0].id : (opts.find((s) => s.teachesIt)?.id ?? "");
}

/** Editor drawer for one lesson plan; read-only details with a review panel when the user cannot edit it. */
export function LessonPlanDrawer({ open, onOpenChange, plan, defaults, sections, canManage, canReview, onChanged }: Props) {
  const toast = useToast();
  const isNew = !plan;
  const editable = canManage && (isNew || plan.editable);
  // The API refuses a review of your own plan, so a principal who also teaches never sees the panel on theirs.
  const reviewable = canReview && plan?.status === "SUBMITTED" && !plan.mine;

  const [sectionId, setSectionId] = useState(plan?.sectionId ?? defaults.sectionId);
  const [subjectId, setSubjectId] = useState(() => plan?.subjectId ?? (defaults.subjectId || defaultSubject(sections, defaults.sectionId)));
  const [weekStart, setWeekStart] = useState(plan?.weekStart ?? defaults.weekStart);
  const [form, setForm] = useState({
    topic: plan?.topic ?? "",
    objectives: plan?.objectives ?? "",
    activities: plan?.activities ?? "",
    resources: plan?.resources ?? "",
    homework: plan?.homework ?? "",
  });
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const section = sections.find((s) => s.id === sectionId);
  // The API already limits teachers to subjects they teach (class teachers: every subject of their class).
  const subjects = section?.subjects ?? [];
  const field = (k: keyof typeof form) => ({
    value: form[k],
    onChange: (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value })),
    disabled: !editable,
  });

  /** A 409 means someone else changed the plan in between: say so, refresh the lists and close. */
  function conflict(e: unknown): boolean {
    if (!(e instanceof ApiError) || e.status !== 409) return false;
    toast.error("This plan was changed by someone else", "We reloaded the plans. Open it again to see the latest version.");
    setConfirmDelete(false);
    onChanged(null);
    onOpenChange(false);
    return true;
  }

  async function persist(): Promise<LessonPlan> {
    const body = { weekStart, ...form };
    if (isNew) return api<LessonPlan>("/lesson-plans", { method: "POST", body: { sectionId, subjectId, ...body } });
    return api<LessonPlan>(`/lesson-plans/${plan.id}`, { method: "PATCH", body });
  }

  async function onSave(submit: boolean) {
    setError("");
    if (!sectionId || !subjectId) return setError("Choose the class and subject.");
    if (!form.topic.trim()) return setError("Give the plan a topic.");
    setBusy(submit ? "submit" : "save");
    try {
      let saved = await persist();
      if (submit) saved = await api<LessonPlan>(`/lesson-plans/${saved.id}/submit`, { method: "POST" });
      toast.success(submit ? "Plan sent for review" : isNew ? "Draft saved" : "Changes saved", `${saved.subjectName}, ${saved.sectionName}, ${weekLabel(saved.weekStart)}`);
      onChanged(saved);
      onOpenChange(false);
    } catch (e) {
      if (!conflict(e)) setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onDelete() {
    if (!plan) return;
    setBusy("delete");
    try {
      await api(`/lesson-plans/${plan.id}`, { method: "DELETE" });
      toast.success("Plan deleted");
      setConfirmDelete(false);
      onChanged(null);
      onOpenChange(false);
    } catch (e) {
      if (!conflict(e)) toast.error("Could not delete the plan", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onReview(decision: "APPROVED" | "NEEDS_CHANGES") {
    if (!plan) return;
    setNoteError("");
    if (decision === "NEEDS_CHANGES" && !note.trim()) {
      setNoteError("Say what needs to change so the teacher can fix it.");
      return;
    }
    setBusy(decision === "APPROVED" ? "approve" : "changes");
    try {
      const saved = await api<LessonPlan>(`/lesson-plans/${plan.id}/review`, { method: "POST", body: { decision, note: note.trim() || undefined } });
      toast.success(decision === "APPROVED" ? "Plan approved" : "Sent back for changes", `${saved.teacher?.name ?? "The teacher"} can see your note.`);
      onChanged(saved);
      onOpenChange(false);
    } catch (e) {
      if (!conflict(e)) setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const meta = plan ? STATUS_META[plan.status] : null;
  const title = isNew ? "New lesson plan" : plan.topic;
  const description = isNew ? "Saved as a draft until you send it for review." : `${plan.subjectName}, ${plan.sectionName}, ${weekLabel(plan.weekStart)}`;

  let footer;
  if (editable) {
    footer = (
      <div className="flex w-full flex-wrap items-center gap-2">
        {!isNew && plan.mine && (
          <Button type="button" variant="ghost" icon={<Trash2 />} onClick={() => setConfirmDelete(true)} disabled={!!busy} className="text-danger-text">
            Delete
          </Button>
        )}
        <span className="flex-1" />
        <Button type="button" variant="secondary" icon={<Save />} loading={busy === "save"} disabled={!!busy} onClick={() => onSave(false)}>
          Save draft
        </Button>
        <Button type="button" icon={<Send />} loading={busy === "submit"} disabled={!!busy} onClick={() => onSave(true)}>
          Send for review
        </Button>
      </div>
    );
  } else if (reviewable) {
    footer = (
      <div className="flex w-full flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" icon={<MessageSquareWarning />} loading={busy === "changes"} disabled={!!busy} onClick={() => onReview("NEEDS_CHANGES")}>
          Needs changes
        </Button>
        <Button type="button" icon={<CircleCheck />} loading={busy === "approve"} disabled={!!busy} onClick={() => onReview("APPROVED")}>
          Approve
        </Button>
      </div>
    );
  }

  return (
    <>
      <Drawer
        open={open}
        onOpenChange={onOpenChange}
        size="lg"
        title={title}
        description={description}
        headerExtra={
          meta && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={meta.tone}>{meta.label}</Badge>
              {plan?.teacher && !plan.mine && <span className="text-[13px] text-fg-muted">By {plan.teacher.name}</span>}
            </div>
          )
        }
        footer={footer}
      >
        <form
          className="flex flex-col gap-5"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (editable) onSave(false);
          }}
        >
          {plan?.status === "NEEDS_CHANGES" && plan.reviewerNote && (
            <Alert tone="warning" title={`${plan.reviewedBy?.name ?? "Your reviewer"} asked for changes`}>
              {plan.reviewerNote}
            </Alert>
          )}
          {plan?.status === "APPROVED" && (
            <Alert tone="success" title={`Approved by ${plan.reviewedBy?.name ?? "the principal"}${plan.reviewedAt ? ` on ${when(plan.reviewedAt)}` : ""}`}>
              {plan.reviewerNote || "No changes needed."}
            </Alert>
          )}
          {plan?.status === "SUBMITTED" && !reviewable && (
            <Alert tone="info" title="Waiting for review">
              Sent {plan.submittedAt ? when(plan.submittedAt) : "recently"}. You can edit it again if it is sent back.
            </Alert>
          )}
          {error && (
            <Alert tone="danger" onDismiss={() => setError("")}>
              {error}
            </Alert>
          )}

          {editable ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="Class and section"
                required
                value={sectionId}
                disabled={!isNew}
                onChange={(e) => {
                  setSectionId(e.target.value);
                  setSubjectId(defaultSubject(sections, e.target.value));
                }}
                placeholder="Choose a section"
                options={sections.map((s) => ({ value: s.id, label: s.name }))}
              />
              <SelectField
                label="Subject"
                required
                value={subjectId}
                disabled={!isNew || !section}
                onChange={(e) => setSubjectId(e.target.value)}
                placeholder={section ? "Choose a subject" : "Pick a section first"}
                options={subjects.map((s) => ({ value: s.id, label: s.name }))}
              />
              <TextField
                label="Week"
                type="date"
                required
                value={weekStart}
                onChange={(e) => e.target.value && setWeekStart(mondayOf(e.target.value))}
                hint={weekLabel(weekStart)}
              />
              <TextField label="Topic" required maxLength={200} placeholder="Fractions: adding unlike denominators" {...field("topic")} />
              <TextareaField
                label="Learning objectives"
                rows={3}
                maxLength={4000}
                placeholder="Students can find a common denominator and add two fractions."
                wrapperClassName="sm:col-span-2"
                {...field("objectives")}
              />
              <TextareaField
                label="Activities"
                rows={4}
                maxLength={4000}
                placeholder="Mon: fraction strips warm-up. Tue: guided practice in pairs. Wed: worksheet 4B."
                wrapperClassName="sm:col-span-2"
                {...field("activities")}
              />
              <TextareaField label="Resources" rows={3} maxLength={2000} placeholder="Textbook pages 42 to 45, fraction strips, whiteboard." {...field("resources")} />
              <TextareaField label="Homework" rows={3} maxLength={2000} placeholder="Exercise 4.2, questions 1 to 10." {...field("homework")} />
            </div>
          ) : (
            plan && (
              <DescriptionList
                columns={2}
                items={[
                  { label: "Class", value: plan.sectionName },
                  { label: "Subject", value: plan.subjectName },
                  { label: "Week", value: weekLabel(plan.weekStart) },
                  { label: "Teacher", value: plan.teacher?.name ?? "Former staff member" },
                  { label: "Learning objectives", value: <Prose text={plan.objectives} />, full: true },
                  { label: "Activities", value: <Prose text={plan.activities} />, full: true },
                  { label: "Resources", value: <Prose text={plan.resources} />, full: true },
                  { label: "Homework", value: <Prose text={plan.homework} />, full: true },
                ]}
              />
            )
          )}

          {reviewable && (
            <div className="border-t border-border pt-5">
              <TextareaField
                label="Note for the teacher"
                rows={3}
                maxLength={2000}
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  if (noteError) setNoteError("");
                }}
                error={noteError || undefined}
                hint="Required when you send the plan back. Optional when approving."
                placeholder="Please add a short assessment at the end of Thursday's lesson."
              />
            </div>
          )}
        </form>
      </Drawer>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this lesson plan?"
        description="The plan and everything written in it will be removed. This cannot be undone."
        confirmLabel="Delete plan"
        destructive
        loading={busy === "delete"}
        onConfirm={onDelete}
      />
    </>
  );
}

function Prose({ text }: { text: string | null }) {
  if (!text) return <span className="text-fg-muted">Not added</span>;
  return <p className="whitespace-pre-line text-sm text-fg">{text}</p>;
}
