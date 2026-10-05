"use client";

import { useState } from "react";
import { Check, UserRound } from "lucide-react";
import { Avatar } from "@/components/kit/avatar";
import { Badge } from "@/components/kit/badge";
import { Button } from "@/components/kit/button";
import { Alert, EmptyState, ErrorState, SkeletonRows } from "@/components/kit/feedback";
import { SelectField } from "@/components/kit/inputs";
import { Dialog } from "@/components/kit/overlay";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useApi } from "@/lib/use-api";
import type { ChatContactGroup, ChatThread } from "./types";

interface NewConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new (or already existing) conversation. */
  onStarted: (thread: ChatThread) => void;
  /** Pre-select this child (e.g. the one picked on the parent dashboard). */
  defaultStudentId?: string | null;
}

/** Parent picker: choose a child, then one of the child's teachers. Opens the existing thread when there is one. */
export function NewConversationDialog({ open, onOpenChange, onStarted, defaultStudentId }: NewConversationDialogProps) {
  const { data, error, reload } = useApi<ChatContactGroup[]>(open ? "/parent/chat/contacts" : null);
  const [studentPick, setStudentPick] = useState<string | null>(null);
  const [staffPick, setStaffPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");

  const studentId = studentPick ?? (data?.find((g) => g.student.id === defaultStudentId)?.student.id ?? data?.[0]?.student.id ?? "");
  const group = data?.find((g) => g.student.id === studentId);
  const contact = group?.contacts.find((c) => c.userId === staffPick);

  function close(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setStaffPick(null);
      setFailure("");
    }
  }

  async function start() {
    if (!group || !contact) return;
    setBusy(true);
    setFailure("");
    try {
      const thread = await api<ChatThread>("/chat/threads", { method: "POST", body: { studentId: group.student.id, staffUserId: contact.userId } });
      onStarted(thread);
      close(false);
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Message a teacher"
      description="Choose your child and the teacher you want to talk to."
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void start()} loading={busy} disabled={!contact}>
            {contact?.threadId ? "Open conversation" : "Start conversation"}
          </Button>
        </>
      }
    >
      {error && !data ? (
        <ErrorState compact message={error} onRetry={reload} />
      ) : !data ? (
        <SkeletonRows rows={4} columns={2} />
      ) : data.length === 0 ? (
        <EmptyState compact icon={<UserRound />} title="No children linked" description="Ask the school office to link your children to this account." />
      ) : (
        <div className="flex flex-col gap-4">
          {data.length > 1 && (
            <SelectField
              label="Child"
              value={studentId}
              onChange={(e) => {
                setStudentPick(e.target.value);
                setStaffPick(null);
              }}
              options={data.map((g) => ({ value: g.student.id, label: g.student.className ? `${g.student.name} (${g.student.className})` : g.student.name }))}
            />
          )}
          {group && group.contacts.length === 0 ? (
            <EmptyState
              compact
              icon={<UserRound />}
              title="No teachers to message yet"
              description={`${group.student.name} has no class teacher or subject teachers assigned this year.`}
            />
          ) : (
            group && (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-sm font-medium text-fg">Teacher of {group.student.name}</legend>
                <div role="radiogroup" aria-label={`Teachers of ${group.student.name}`} className="flex max-h-[45vh] flex-col gap-2 overflow-y-auto">
                  {group.contacts.map((c) => {
                    const selected = c.userId === staffPick;
                    return (
                      <button
                        key={c.userId}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setStaffPick(c.userId)}
                        className={cn(
                          "flex items-center gap-3 rounded-lg border px-3 py-2.5 text-start transition-colors duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
                          selected ? "border-primary bg-primary-tint" : "border-border hover:bg-surface-3",
                        )}
                      >
                        <Avatar name={c.name} size="sm" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-fg">{c.name}</span>
                            {c.isClassTeacher && <Badge tone="primary">Class teacher</Badge>}
                          </span>
                          <span className="truncate text-xs text-fg-muted">
                            {c.subjects.length ? c.subjects.join(", ") : "Class teacher"}
                            {c.threadId ? ". You have a conversation already" : ""}
                          </span>
                        </span>
                        {selected && <Check className="size-4 shrink-0 text-brand" aria-hidden />}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            )
          )}
          {failure && <Alert tone="danger">{failure}</Alert>}
        </div>
      )}
    </Dialog>
  );
}
