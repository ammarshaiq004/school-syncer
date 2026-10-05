"use client";

import { useState } from "react";
import { Check, UserRound } from "lucide-react";
import { Avatar } from "@/components/kit/avatar";
import { Badge } from "@/components/kit/badge";
import { Button } from "@/components/kit/button";
import { Alert, EmptyState, ErrorState, SkeletonRows } from "@/components/kit/feedback";
import { SearchInput } from "@/components/kit/inputs";
import { Dialog } from "@/components/kit/overlay";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useApi } from "@/lib/use-api";
import type { ChatStaffContactGroup, ChatThread } from "./types";

interface NewStaffConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new (or already existing) conversation. */
  onStarted: (thread: ChatThread) => void;
}

/** How many students the list shows at once; the search box narrows it down. */
const SHOWN = 40;

const rowClass = (selected: boolean) =>
  cn(
    "flex items-center gap-3 rounded-lg border px-3 py-2.5 text-start transition-colors duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
    selected ? "border-primary bg-primary-tint" : "border-border hover:bg-surface-3",
  );

/**
 * Staff picker: find a student you teach, then the parent to message.
 * Opens the existing conversation when there is one already.
 */
export function NewStaffConversationDialog({ open, onOpenChange, onStarted }: NewStaffConversationDialogProps) {
  const { data, error, reload } = useApi<ChatStaffContactGroup[]>(open ? "/chat/contacts" : null);
  const [query, setQuery] = useState("");
  const [studentPick, setStudentPick] = useState<string | null>(null);
  const [guardianPick, setGuardianPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");

  const q = query.trim().toLowerCase();
  const matches = (data ?? []).filter(
    (g) => !q || `${g.student.name} ${g.student.admissionNo} ${g.student.className ?? ""}`.toLowerCase().includes(q),
  );
  const group = data?.find((g) => g.student.id === studentPick) ?? null;
  const guardian = group?.guardians.find((x) => x.userId === guardianPick) ?? null;

  function close(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setStudentPick(null);
      setGuardianPick(null);
      setQuery("");
      setFailure("");
    }
  }

  async function start() {
    if (!group || !guardian) return;
    setBusy(true);
    setFailure("");
    try {
      const thread = await api<ChatThread>("/chat/threads", {
        method: "POST",
        body: { studentId: group.student.id, guardianUserId: guardian.userId },
      });
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
      title="New message"
      description="Choose a student you teach, then the parent you want to talk to."
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void start()} loading={busy} disabled={!guardian}>
            {guardian?.threadId ? "Open conversation" : "Start conversation"}
          </Button>
        </>
      }
    >
      {error && !data ? (
        <ErrorState compact message={error} onRetry={reload} />
      ) : !data ? (
        <SkeletonRows rows={4} columns={2} />
      ) : data.length === 0 ? (
        <EmptyState
          compact
          icon={<UserRound />}
          title="No students to message"
          description="You can message the parents of students in sections you teach or class-teach."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <SearchInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClear={() => setQuery("")}
            placeholder="Find a student"
            wrapperClassName="w-full"
          />
          {matches.length === 0 ? (
            <EmptyState compact title="No students match" description={`Nobody you teach matches "${query}".`} />
          ) : (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium text-fg">Student</legend>
              <div role="radiogroup" aria-label="Students you teach" className="flex max-h-[32vh] flex-col gap-2 overflow-y-auto">
                {matches.slice(0, SHOWN).map((g) => {
                  const selected = g.student.id === studentPick;
                  return (
                    <button
                      key={g.student.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => {
                        setStudentPick(g.student.id);
                        setGuardianPick(g.guardians.length === 1 ? g.guardians[0].userId : null);
                      }}
                      className={rowClass(selected)}
                    >
                      <Avatar name={g.student.name} src={g.student.photoUrl} size="sm" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium text-fg">{g.student.name}</span>
                        <span className="truncate text-xs text-fg-muted">
                          {g.student.admissionNo}
                          {g.student.className ? ` · ${g.student.className}` : ""}
                          {g.guardians.length === 0 ? " · No parent login" : ""}
                        </span>
                      </span>
                      {selected && <Check className="size-4 shrink-0 text-brand" aria-hidden />}
                    </button>
                  );
                })}
              </div>
              {matches.length > SHOWN && (
                <p className="text-xs text-fg-muted">
                  Showing {SHOWN} of {matches.length} students. Search to narrow the list.
                </p>
              )}
            </fieldset>
          )}

          {group &&
            (group.guardians.length === 0 ? (
              <EmptyState
                compact
                icon={<UserRound />}
                title="No parent account yet"
                description={`${group.student.name} has no guardian with a login. Ask the school office to invite one.`}
              />
            ) : (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-sm font-medium text-fg">Parent of {group.student.name}</legend>
                <div role="radiogroup" aria-label={`Guardians of ${group.student.name}`} className="flex flex-col gap-2">
                  {group.guardians.map((x) => {
                    const selected = x.userId === guardianPick;
                    return (
                      <button
                        key={x.userId}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setGuardianPick(x.userId)}
                        className={rowClass(selected)}
                      >
                        <Avatar name={x.name} size="sm" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-fg">{x.name}</span>
                            {x.isPrimary && <Badge tone="primary">Primary</Badge>}
                          </span>
                          <span className="truncate text-xs text-fg-muted">
                            {x.relation}
                            {x.threadId ? ". You have a conversation already" : ""}
                          </span>
                        </span>
                        {selected && <Check className="size-4 shrink-0 text-brand" aria-hidden />}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ))}

          {failure && <Alert tone="danger">{failure}</Alert>}
        </div>
      )}
    </Dialog>
  );
}
