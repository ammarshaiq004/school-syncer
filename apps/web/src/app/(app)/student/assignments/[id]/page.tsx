"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ClipboardList, ExternalLink, Link2, MessageSquareText, Paperclip, Pencil, Send } from "lucide-react";
import { ASSIGNMENT_STATE } from "@/components/student/format";
import { dateTime, handedInText, scoreTone, timeLeft } from "@/components/student-learning/format";
import { RichText } from "@/components/student-learning/rich-text";
import type { StudentAssignmentDetail, StudentSubmission } from "@/components/student-learning/types";
import {
  Alert,
  Button,
  buttonClass,
  Card,
  CardHeader,
  DescriptionList,
  EmptyState,
  ErrorState,
  PageHeader,
  ProgressRing,
  SkeletonRows,
  StatusPill,
  TextareaField,
  TextField,
  useToast,
} from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";

/** One assignment: instructions, hand in or resubmit text and a link, and the grade with feedback. */
export default function StudentAssignmentPage() {
  const { id } = useParams<{ id: string }>();
  const { data: a, error, errorStatus, reload } = useApi<StudentAssignmentDetail>(`/student/assignments/${id}`);
  const [editing, setEditing] = useState(false);

  if (error && !a) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Assignment" breadcrumbs={[{ label: "Assignments", href: "/student/assignments" }, { label: "Assignment" }]} />
        <Card padding="none">
          {errorStatus === 404 ? (
            <EmptyState
              icon={<ClipboardList />}
              title="This assignment is not available"
              description="It may have been removed or unpublished by your teacher."
              action={<Link href="/student/assignments" className={buttonClass("secondary", "sm")}>Back to assignments</Link>}
            />
          ) : (
            <ErrorState message={error} onRetry={reload} />
          )}
        </Card>
      </div>
    );
  }

  const st = a ? ASSIGNMENT_STATE[a.state] : null;
  const sub = a?.submission ?? null;
  const graded = sub && (sub.status === "GRADED" || sub.status === "RETURNED") && sub.points != null;
  const showForm = !!a && a.canSubmit && (!sub || editing || sub.status === "RETURNED");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={a?.title ?? "Loading assignment"}
        description={a ? `${a.subject.name}${a.course && a.course.title !== a.subject.name ? `, ${a.course.title}` : ""}` : undefined}
        breadcrumbs={[{ label: "Assignments", href: "/student/assignments" }, { label: a?.title ?? "Assignment" }]}
        meta={
          a &&
          st && (
            <span className="flex flex-wrap items-center gap-2">
              <StatusPill status={a.state} label={st.label} tone={st.tone} />
              {sub?.isLate && <StatusPill status="LATE" label="Handed in late" />}
            </span>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader icon={<ClipboardList />} title="Instructions" />
            {!a ? (
              <SkeletonRows rows={4} columns={1} />
            ) : (
              <div className="flex flex-col gap-4">
                {a.instructions ? <RichText text={a.instructions} /> : <p className="text-sm text-fg-muted">No written instructions. Check the attachment or ask your teacher.</p>}
                {a.attachmentUrl && (
                  <a
                    href={a.attachmentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-fit items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm font-medium text-fg hover:border-border-strong"
                  >
                    <Paperclip className="size-4 text-brand" aria-hidden />
                    Open the attachment
                    <ExternalLink className="size-3.5 text-fg-muted" aria-hidden />
                  </a>
                )}
              </div>
            )}
          </Card>

          {a && graded && sub && (
            <Card className="animate-rise">
              <CardHeader icon={<MessageSquareText />} title={sub.status === "RETURNED" ? "Returned for another go" : "Your grade"} />
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <ProgressRing
                  value={sub.points!}
                  max={a.maxPoints}
                  size={88}
                  stroke={8}
                  tone={scoreTone((sub.points! / a.maxPoints) * 100)}
                  label={`${sub.points} out of ${a.maxPoints} points`}
                >
                  <span className="text-center leading-tight">
                    <span className="block font-display text-lg font-semibold tabular-nums text-fg">{sub.points}</span>
                    <span className="block text-xs tabular-nums text-fg-muted">of {a.maxPoints}</span>
                  </span>
                </ProgressRing>
                <div className="min-w-0 flex-1">
                  {sub.feedback ? (
                    <blockquote className="rounded-lg border-s-4 border-primary bg-surface-2 px-4 py-3">
                      <p className="whitespace-pre-line text-sm text-fg">{sub.feedback}</p>
                      {a.createdBy && <footer className="mt-1.5 text-xs text-fg-muted">{a.createdBy.name}</footer>}
                    </blockquote>
                  ) : (
                    <p className="text-sm text-fg-muted">Your teacher did not leave written feedback.</p>
                  )}
                  {sub.gradedAt && <p className="mt-2 text-xs text-fg-muted">Graded {dateTime(sub.gradedAt)}</p>}
                  {sub.status === "RETURNED" && (
                    <Alert tone="warning" className="mt-3">
                      Your teacher sent this back. Improve your work and hand it in again below.
                    </Alert>
                  )}
                </div>
              </div>
            </Card>
          )}

          {a && (
            <Card>
              <CardHeader
                icon={<Send />}
                title={sub ? "Your submission" : "Hand in your work"}
                action={
                  sub && !showForm && a.canSubmit ? (
                    <Button type="button" variant="secondary" size="sm" icon={<Pencil />} onClick={() => setEditing(true)}>
                      Edit and resubmit
                    </Button>
                  ) : undefined
                }
              />
              {showForm ? (
                <SubmissionForm
                  key={sub?.submittedAt ?? "new"}
                  assignment={a}
                  onCancel={sub && sub.status !== "RETURNED" ? () => setEditing(false) : undefined}
                  onSaved={() => {
                    setEditing(false);
                    void reload();
                  }}
                />
              ) : sub ? (
                <SubmissionView sub={sub} />
              ) : (
                <Alert tone="danger" title="Submissions are closed">
                  {a.blockedReason ?? "The due date has passed and this assignment does not accept late work."}
                </Alert>
              )}
              {sub && !a.canSubmit && a.blockedReason && sub.status !== "GRADED" && (
                <p className="mt-3 text-[13px] text-fg-muted">{a.blockedReason}</p>
              )}
            </Card>
          )}
        </div>

        <Card className="h-fit">
          <CardHeader title="Details" />
          {!a ? (
            <SkeletonRows rows={5} columns={1} />
          ) : (
            <DescriptionList
              columns={1}
              items={[
                { label: "Due", value: <span className="tabular-nums">{dateTime(a.dueAt)}</span> },
                ...(sub
                  ? [
                      {
                        label: "Time",
                        value: <span className={sub.isLate ? "text-danger-text" : "text-success-text"}>{handedInText(a.dueAt, sub.submittedAt)}</span>,
                      },
                    ]
                  : a.urgency
                    ? [{ label: "Time", value: <span className={a.hoursLeft < 0 ? "text-danger-text" : undefined}>{timeLeft(a.hoursLeft)}</span> }]
                    : []),
                { label: "Points", value: `${a.maxPoints} points` },
                { label: "Late work", value: a.allowLate ? "Accepted, marked late" : "Not accepted" },
                { label: "Subject", value: a.subject.name },
                ...(a.createdBy ? [{ label: "Teacher", value: a.createdBy.name }] : []),
                ...(sub ? [{ label: "Handed in", value: <span className="tabular-nums">{dateTime(sub.submittedAt)}</span> }] : []),
              ]}
            />
          )}
        </Card>
      </div>
    </div>
  );
}

function SubmissionView({ sub }: { sub: StudentSubmission }) {
  return (
    <div className="flex flex-col gap-3">
      {sub.body && <p className="whitespace-pre-line rounded-lg bg-surface-2 p-4 text-sm text-fg">{sub.body}</p>}
      {sub.linkUrl && (
        <a href={sub.linkUrl} target="_blank" rel="noopener noreferrer" className="inline-flex w-fit max-w-full items-center gap-2 text-sm font-medium text-brand hover:underline">
          <Link2 className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{sub.linkUrl}</span>
          <ExternalLink className="size-3.5 shrink-0" aria-hidden />
        </a>
      )}
      <p className="text-xs text-fg-muted">
        Handed in {dateTime(sub.submittedAt)}
        {sub.isLate ? ", after the due date" : ""}
        {sub.status === "SUBMITTED" ? ". Waiting for your teacher to grade it." : "."}
      </p>
    </div>
  );
}

function SubmissionForm({
  assignment: a,
  onSaved,
  onCancel,
}: {
  assignment: StudentAssignmentDetail;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const toast = useToast();
  const [body, setBody] = useState(a.submission?.body ?? "");
  const [link, setLink] = useState(a.submission?.linkUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const linkError = link.trim() && !/^https:\/\/\S+$/i.test(link.trim()) ? "Paste a full link starting with https://" : "";
  const late = a.hoursLeft < 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    if (!body.trim() && !link.trim()) {
      setErr("Write your answer or paste a link to your work.");
      return;
    }
    if (linkError) return;
    setSaving(true);
    try {
      await api(`/student/assignments/${a.id}/submission`, {
        method: "PUT",
        body: { ...(body.trim() ? { body: body.trim() } : {}), ...(link.trim() ? { linkUrl: link.trim() } : {}) },
      });
      toast.success(a.submission ? "Work resubmitted" : "Work handed in", a.title);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {late && a.allowLate && (
        <Alert tone="warning">The due date has passed. You can still hand in, but it will be marked late.</Alert>
      )}
      {err && <Alert tone="danger">{err}</Alert>}
      <TextareaField
        label="Your answer"
        hint="Type your answer, or describe what you are handing in."
        rows={8}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={20000}
      />
      <TextField
        label="Link to your work (optional)"
        hint="Google Drive, Docs, a video or any https link. Make sure your teacher can open it."
        type="url"
        inputMode="url"
        placeholder="https://docs.google.com/..."
        value={link}
        onChange={(e) => setLink(e.target.value)}
        error={linkError || undefined}
      />
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" icon={<Send />} loading={saving}>
          {a.submission ? "Resubmit" : "Hand in"}
        </Button>
      </div>
    </form>
  );
}
