"use client";

import Link from "next/link";
import { Copy, MessageCircle, Save, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { Alert, Badge, Button, buttonClass, Card, CardHeader, IconButton, SearchInput, SegmentedControl, SelectField, Textarea, TextareaField, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import type { AssistantOptions, AssistantStatus, DraftKind, DraftResponse, DraftTarget, StudentHit } from "./assistant-types";

const REMARK_MAX = 300;

/**
 * Report card remarks and parent messages (SCHOOL-106). A student handed over
 * from the at-risk tab arrives as `target`; the page remounts this panel (key)
 * for each hand-over so the form starts from it.
 */
export function DraftPanel({
  status,
  options,
  target,
  onUsed,
  canRemark,
  canChat,
}: {
  status: AssistantStatus;
  options: AssistantOptions | null;
  target: DraftTarget | null;
  onUsed: () => void;
  canRemark: boolean;
  canChat: boolean;
}) {
  const toast = useToast();
  const [kind, setKind] = useState<DraftKind>(target?.kind ?? (canRemark ? "report_remark" : "parent_message"));
  const [student, setStudent] = useState<StudentHit | null>(target?.student ?? null);
  const [query, setQuery] = useState("");
  const [examId, setExamId] = useState("");
  const [notes, setNotes] = useState(target?.notes ?? "");
  const [tone, setTone] = useState<"warm" | "neutral" | "firm">("warm");
  const [language, setLanguage] = useState<"en" | "ur">("en");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const q = query.trim();
  const hits = useApi<StudentHit[]>(!student && q.length >= 2 ? `/assistant/students?q=${encodeURIComponent(q)}` : null);

  async function generate() {
    if (!student) return;
    setBusy(true);
    setError("");
    try {
      const res = await api<DraftResponse>("/assistant/draft", {
        method: "POST",
        body: {
          kind,
          studentId: student.studentId,
          ...(kind === "report_remark" && examId ? { examId } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          tone,
          language,
        },
      });
      setDraft(res);
      setText(res.text);
      if (res.source === "ai") onUsed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Could not copy", "Select the text and copy it instead.");
    }
  }

  async function saveRemark() {
    if (!student || !draft?.examId) return;
    setSaving(true);
    try {
      await api(`/exams/${draft.examId}/results/${student.studentId}/remarks`, { method: "PUT", body: { teacherRemark: text.trim() } });
      toast.success("Saved to the report card");
    } catch (e) {
      toast.error("Could not save the remark", (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const kinds = [
    ...(canRemark ? [{ value: "report_remark" as const, label: "Report card remark" }] : []),
    { value: "parent_message" as const, label: "Message to parent" },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="flex flex-col gap-4">
        <CardHeader title="What to write" description={status.ai ? "Claude drafts it from the student's record; you edit before using it." : "AI is off on this server, so drafts come from a template you can edit."} />
        {kinds.length > 1 && <SegmentedControl aria-label="Draft type" value={kind} onChange={(v) => (setKind(v), setDraft(null))} options={kinds} />}

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Student</span>
          {student ? (
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <div>
                <p className="text-sm font-medium">{student.name}</p>
                <p className="text-xs text-fg-muted">
                  {student.class ?? "No class"} · {student.admissionNo}
                </p>
              </div>
              <IconButton aria-label="Change student" size="sm" onClick={() => (setStudent(null), setDraft(null))}>
                <X />
              </IconButton>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <SearchInput aria-label="Find a student" placeholder="Name or admission number" value={query} onChange={(e) => setQuery(e.target.value)} onClear={() => setQuery("")} />
              {hits.data && (
                <ul className="max-h-56 overflow-y-auto rounded-lg border border-border">
                  {hits.data.length ? (
                    hits.data.map((h) => (
                      <li key={h.studentId}>
                        <button type="button" className="flex w-full justify-between px-3 py-2 text-start text-sm hover:bg-surface-2" onClick={() => (setStudent(h), setQuery(""))}>
                          <span>{h.name}</span>
                          <span className="text-fg-muted">{h.class ?? h.admissionNo}</span>
                        </button>
                      </li>
                    ))
                  ) : (
                    <li className="px-3 py-2 text-sm text-fg-muted">No student in your classes matches.</li>
                  )}
                </ul>
              )}
            </div>
          )}
        </div>

        {kind === "report_remark" && (
          <SelectField
            label="Exam"
            value={examId}
            onChange={(e) => setExamId(e.target.value)}
            placeholder="Latest published exam"
            options={(options?.exams ?? []).map((e) => ({ value: e.id, label: e.name }))}
          />
        )}
        <TextareaField
          label="Your notes (optional)"
          hint={status.ai ? "What you want to say, in your own words. Claude keeps to the facts on record." : "Added to the draft as you write it."}
          rows={3}
          maxLength={1000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Tone"
            value={tone}
            onChange={(e) => setTone(e.target.value as typeof tone)}
            options={[
              { value: "warm", label: "Warm" },
              { value: "neutral", label: "Neutral" },
              { value: "firm", label: "Firm" },
            ]}
          />
          <SelectField
            label="Language"
            value={language}
            onChange={(e) => setLanguage(e.target.value as typeof language)}
            options={[
              { value: "en", label: "English" },
              { value: "ur", label: "Urdu" + (status.ai ? "" : " (needs AI)") , disabled: !status.ai },
            ]}
          />
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        <Button icon={<Sparkles />} loading={busy} disabled={!student} onClick={() => void generate()} className="self-start">
          {draft ? "Write again" : "Write draft"}
        </Button>
      </Card>

      <Card className="flex flex-col gap-3">
        <CardHeader
          title="Draft"
          action={draft && <Badge tone={draft.source === "ai" ? "primary" : "neutral"}>{draft.source === "ai" ? "Written by Claude" : "Template"}</Badge>}
        />
        {draft ? (
          <>
            <Textarea aria-label="Draft text" rows={kind === "report_remark" ? 5 : 10} value={text} onChange={(e) => setText(e.target.value)} dir="auto" />
            {kind === "report_remark" && (
              <p className={`text-xs ${text.length > REMARK_MAX ? "text-danger-text" : "text-fg-muted"}`}>
                {text.length}/{REMARK_MAX} characters
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" icon={<Copy />} onClick={() => void copy()}>
                Copy
              </Button>
              {kind === "report_remark" && draft.examId && (
                <Button icon={<Save />} loading={saving} disabled={!text.trim() || text.length > REMARK_MAX} onClick={() => void saveRemark()}>
                  Save to report card
                </Button>
              )}
              {kind === "parent_message" && canChat && (
                <Link href="/chat" className={buttonClass("primary")}>
                  <MessageCircle className="size-4" aria-hidden /> Open parent chat
                </Link>
              )}
            </div>
            {kind === "report_remark" && !draft.examId && <p className="text-xs text-fg-muted">This student has no published result yet, so the remark cannot be saved to a report card.</p>}
          </>
        ) : (
          <p className="text-sm text-fg-muted">Pick a student and press Write draft. Nothing is sent or saved until you choose to.</p>
        )}
      </Card>
    </div>
  );
}
