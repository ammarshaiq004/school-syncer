"use client";

import { useState, type FormEvent } from "react";
import { ListChecks, Plus, Trash2 } from "lucide-react";
import { DataTable, type Column } from "@/components/kit/data-table";
import { NativeSelect, TextareaField } from "@/components/kit/inputs";
import { Alert, Button, Drawer, EmptyState, ErrorState, IconButton, ProgressBar, SkeletonRows, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";

interface Overview {
  sectionId: string;
  sectionName: string;
  subjectId: string;
  subjectName: string;
  total: number;
  done: number;
  started: number;
  percent: number;
}
type Status = "PENDING" | "IN_PROGRESS" | "DONE";
interface Topic {
  id: string;
  title: string;
  status: Status;
}
interface Detail {
  canEdit: boolean;
  progress: { total: number; done: number; percent: number };
  topics: Topic[];
}

const STATUS = [
  { value: "PENDING", label: "Not started" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "DONE", label: "Done" },
];

/** What each class must cover in each subject, and how much of it the teacher has finished. */
export function SyllabusPanel({ canManage }: { canManage: boolean }) {
  const overview = useApi<Overview[]>("/syllabus/overview");
  const [open, setOpen] = useState<Overview | null>(null);

  const columns: Column<Overview>[] = [
    { id: "section", header: "Class", cell: (r) => <span className="font-medium">{r.sectionName}</span>, sortValue: (r) => r.sectionName },
    { id: "subject", header: "Subject", cell: (r) => r.subjectName, sortValue: (r) => r.subjectName },
    {
      id: "progress",
      header: "Covered",
      cell: (r) =>
        r.total === 0 ? (
          <span className="text-fg-muted">No topics yet</span>
        ) : (
          <div className="flex items-center gap-3">
            <ProgressBar value={r.percent} className="w-32" aria-label={`${r.subjectName} ${r.sectionName} syllabus covered`} />
            <span className="text-[13px] tabular-nums text-fg-muted">
              {r.done} of {r.total} · {r.percent}%
            </span>
          </div>
        ),
      sortValue: (r) => r.percent,
    },
  ];

  return (
    <>
      <DataTable
        label="Syllabus progress"
        columns={columns}
        data={overview.data}
        error={overview.error}
        onRetry={overview.reload}
        getRowId={(r) => `${r.sectionId}:${r.subjectId}`}
        getSearchText={(r) => `${r.sectionName} ${r.subjectName}`}
        searchPlaceholder="Search class or subject"
        onRowClick={setOpen}
        getRowLabel={(r) => `Open ${r.subjectName} syllabus for ${r.sectionName}`}
        empty={{ title: "No classes yet", description: "Subjects you teach appear here once classes have subjects.", icon: <ListChecks /> }}
      />
      <TopicsDrawer
        target={open}
        canManage={canManage}
        onClose={() => setOpen(null)}
        onChanged={overview.reload}
      />
    </>
  );
}

function TopicsDrawer({ target, canManage, onClose, onChanged }: { target: Overview | null; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const path = target ? `/syllabus?sectionId=${target.sectionId}&subjectId=${target.subjectId}` : null;
  const detail = useApi<Detail>(path);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function change<T>(run: () => Promise<T>) {
    try {
      await run();
      detail.reload();
      onChanged();
    } catch (e) {
      toast.error("Could not save", (e as Error).message);
    }
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target) return;
    const form = event.currentTarget;
    const topics = String(new FormData(form).get("topics") ?? "");
    setBusy(true);
    try {
      await api("/syllabus", { method: "POST", body: { sectionId: target.sectionId, subjectId: target.subjectId, topics } });
      form.reset();
      setError("");
      detail.reload();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const d = detail.data;
  const editable = canManage && !!d?.canEdit;
  return (
    <Drawer
      open={target !== null}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={target ? `${target.subjectName} · ${target.sectionName}` : "Syllabus"}
      description={d ? `${d.progress.done} of ${d.progress.total} topics done (${d.progress.percent}%)` : undefined}
    >
      {detail.error && !d ? (
        <ErrorState message={detail.error} onRetry={detail.reload} compact />
      ) : !d ? (
        <SkeletonRows rows={4} columns={1} />
      ) : (
        <div className="space-y-4">
          <ProgressBar value={d.progress.percent} aria-label="Syllabus covered" />
          {d.topics.length === 0 ? (
            <EmptyState title="No topics yet" description={editable ? "Paste the topics below, one per line." : "The teacher has not added topics."} />
          ) : (
            <ul className="space-y-2">
              {d.topics.map((t, i) => (
                <li key={t.id} className="flex items-center gap-2 rounded-lg border border-border p-2">
                  <span className="w-6 text-right text-[13px] tabular-nums text-fg-muted">{i + 1}</span>
                  <span className={t.status === "DONE" ? "min-w-0 flex-1 text-fg-muted line-through" : "min-w-0 flex-1 text-fg"}>{t.title}</span>
                  {editable ? (
                    <>
                      <NativeSelect
                        wrapperClassName="w-36 shrink-0"
                        value={t.status}
                        aria-label={`Status of ${t.title}`}
                        onChange={(e) => change(() => api(`/syllabus/${t.id}`, { method: "PATCH", body: { status: e.target.value } }))}
                        options={STATUS}
                      />
                      <IconButton aria-label={`Remove ${t.title}`} variant="ghost" onClick={() => change(() => api(`/syllabus/${t.id}`, { method: "DELETE" }))}>
                        <Trash2 />
                      </IconButton>
                    </>
                  ) : (
                    <span className="text-[13px] text-fg-muted">{STATUS.find((s) => s.value === t.status)?.label}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {editable && (
            <form onSubmit={add} className="space-y-2">
              <TextareaField label="Add topics" name="topics" rows={4} required placeholder={"Fractions\nDecimals\nRatio and proportion"} />
              {error && <Alert tone="danger">{error}</Alert>}
              <Button type="submit" icon={<Plus />} loading={busy}>
                Add topics
              </Button>
            </form>
          )}
        </div>
      )}
    </Drawer>
  );
}
