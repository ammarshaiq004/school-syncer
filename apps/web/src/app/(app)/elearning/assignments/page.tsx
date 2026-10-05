"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CircleCheck, ClipboardCheck, Clock, Ellipsis, Eye, EyeOff, FileCheck, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  IconButton,
  KpiCard,
  NativeSelect,
  PageHeader,
  ProgressBar,
  StatGrid,
  StatusPill,
  useToast,
  type Column,
} from "@/components/ui";
import { AssignmentDialog } from "@/components/elearning/assess-assignment-dialog";
import { whenText, type AssignmentRow } from "@/components/elearning/assess-types";
import { sectionName } from "@/components/elearning/courses-types";
import { useNow } from "@/components/elearning/live-status";
import { api } from "@/lib/api";
import { useCan } from "@/lib/session";
import { useApi } from "@/lib/use-api";

type StatusFilter = "" | "to_grade" | "open" | "past" | "draft";

export default function AssignmentsPage() {
  const router = useRouter();
  const toast = useToast();
  const can = useCan();
  const canManage = can("elearning", "manage");
  const { data, error, reload } = useApi<AssignmentRow[]>("/elearning/assignments");
  const [sectionId, setSectionId] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [editing, setEditing] = useState<AssignmentRow | "new" | null>(null);
  const [removing, setRemoving] = useState<AssignmentRow | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow(60_000);

  const sectionOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of data ?? []) map.set(a.sectionId, sectionName(a.section));
    return [...map].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  }, [data]);

  const rows = useMemo(
    () =>
      (data ?? []).filter((a) => {
        if (sectionId && a.sectionId !== sectionId) return false;
        const past = new Date(a.dueAt).getTime() < now;
        if (status === "to_grade") return a.toGradeCount > 0;
        if (status === "open") return a.isPublished && !past;
        if (status === "past") return a.isPublished && past;
        if (status === "draft") return !a.isPublished;
        return true;
      }),
    [data, sectionId, status, now],
  );

  const totals = useMemo(() => {
    const list = data ?? [];
    return {
      open: list.filter((a) => a.isPublished && new Date(a.dueAt).getTime() >= now).length,
      toGrade: list.reduce((n, a) => n + a.toGradeCount, 0),
      graded: list.reduce((n, a) => n + a.gradedCount, 0),
      late: list.reduce((n, a) => n + a.lateCount, 0),
      drafts: list.filter((a) => !a.isPublished).length,
    };
  }, [data, now]);

  async function togglePublish(a: AssignmentRow) {
    try {
      await api(`/elearning/assignments/${a.id}`, { method: "PATCH", body: { isPublished: !a.isPublished } });
      toast.success(a.isPublished ? "Moved to draft" : "Assignment published", a.title);
      await reload();
    } catch (e) {
      toast.error("Could not update assignment", (e as Error).message);
    }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api(`/elearning/assignments/${removing.id}`, { method: "DELETE" });
      toast.success("Assignment deleted", removing.title);
      setRemoving(null);
      await reload();
    } catch (e) {
      toast.error("Could not delete assignment", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<AssignmentRow>[] = [
    {
      id: "title",
      header: "Assignment",
      sortValue: (a) => a.title,
      cell: (a) => (
        <div className="min-w-0">
          <Link href={`/elearning/assignments/${a.id}`} className="font-medium text-fg hover:text-brand">
            {a.title}
          </Link>
          <p className="truncate text-xs text-fg-muted">
            {a.subject.name}
            {a.course ? ` · ${a.course.title}` : ""}
          </p>
        </div>
      ),
    },
    { id: "section", header: "Section", sortValue: (a) => sectionName(a.section), cell: (a) => sectionName(a.section) },
    {
      id: "due",
      header: "Due",
      sortValue: (a) => a.dueAt,
      cell: (a) => {
        const past = new Date(a.dueAt).getTime() < now;
        return (
          <span className={past ? "text-fg-muted" : "text-fg"}>
            {whenText(a.dueAt)}
            {past && <span className="sr-only"> (closed)</span>}
          </span>
        );
      },
    },
    {
      id: "submitted",
      header: "Handed in",
      width: "150px",
      hideBelow: "md",
      sortValue: (a) => (a.studentCount ? a.submittedCount / a.studentCount : 0),
      cell: (a) => <ProgressBar value={a.submittedCount} max={a.studentCount || 1} size="sm" valueText={`${a.submittedCount}/${a.studentCount}`} label={<span className="sr-only">Handed in</span>} />,
    },
    {
      id: "toGrade",
      header: "To grade",
      align: "right",
      sortValue: (a) => a.toGradeCount,
      cell: (a) => (a.toGradeCount ? <Badge tone="warning">{a.toGradeCount}</Badge> : <span className="text-fg-muted">0</span>),
    },
    {
      id: "points",
      header: "Points",
      align: "right",
      hideBelow: "lg",
      sortValue: (a) => a.maxPoints,
      cell: (a) => a.maxPoints,
    },
    { id: "status", header: "Status", sortValue: (a) => (a.isPublished ? 1 : 0), cell: (a) => <StatusPill status={a.isPublished ? "PUBLISHED" : "DRAFT"} /> },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      width: "48px",
      cell: (a) =>
        a.canManage ? (
          <DropdownMenu trigger={<IconButton size="sm" aria-label={`Actions for ${a.title}`}><Ellipsis /></IconButton>}>
            <DropdownItem icon={<ClipboardCheck />} href={`/elearning/assignments/${a.id}`}>
              Grade submissions
            </DropdownItem>
            <DropdownItem icon={<Pencil />} onSelect={() => setEditing(a)}>
              Edit details
            </DropdownItem>
            <DropdownItem icon={a.isPublished ? <EyeOff /> : <Eye />} onSelect={() => void togglePublish(a)}>
              {a.isPublished ? "Move to draft" : "Publish"}
            </DropdownItem>
            <DropdownSeparator />
            <DropdownItem icon={<Trash2 />} danger onSelect={() => setRemoving(a)}>
              Delete
            </DropdownItem>
          </DropdownMenu>
        ) : null,
    },
  ];

  const loading = !data && !error;
  const newButton = canManage ? (
    <Button icon={<Plus />} onClick={() => setEditing("new")}>
      New assignment
    </Button>
  ) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Assignments"
        description="Coursework students hand in online. Grade submissions, leave feedback or send work back for another go."
        breadcrumbs={[{ label: "E-school", href: "/elearning" }, { label: "Assignments" }]}
        actions={newButton}
      />

      <StatGrid>
        <KpiCard label="Open assignments" value={totals.open} icon={<Clock />} tone="info" loading={loading} error={!!error} hint={`${totals.drafts} in draft`} />
        <KpiCard label="Waiting to be graded" value={totals.toGrade} icon={<ClipboardCheck />} tone={totals.toGrade ? "warning" : "success"} loading={loading} error={!!error} hint="Handed in, not graded yet" />
        <KpiCard label="Graded" value={totals.graded} icon={<CircleCheck />} tone="success" loading={loading} error={!!error} hint="Including work returned to redo" />
        <KpiCard label="Handed in late" value={totals.late} icon={<FileCheck />} tone={totals.late ? "danger" : "neutral"} loading={loading} error={!!error} hint="After the due time" />
      </StatGrid>

      <DataTable
        label="Assignments"
        columns={columns}
        data={data ? rows : null}
        error={error}
        onRetry={reload}
        getRowId={(a) => a.id}
        getSearchText={(a) => `${a.title} ${a.subject.name} ${sectionName(a.section)} ${a.course?.title ?? ""}`}
        searchPlaceholder="Search title, subject or section"
        filters={
          <>
            <NativeSelect aria-label="Section" placeholder="All sections" options={sectionOptions} value={sectionId} onChange={(e) => setSectionId(e.target.value)} wrapperClassName="w-40" />
            <NativeSelect
              aria-label="Status"
              placeholder="All assignments"
              options={[
                { value: "to_grade", label: "Has work to grade" },
                { value: "open", label: "Open (before due)" },
                { value: "past", label: "Past due" },
                { value: "draft", label: "Draft" },
              ]}
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
              wrapperClassName="w-48"
            />
          </>
        }
        filtered={!!(sectionId || status)}
        defaultSort={{ id: "due", dir: "desc" }}
        onRowClick={(a) => router.push(`/elearning/assignments/${a.id}`)}
        getRowLabel={(a) => a.title}
        empty={{
          title: "No assignments yet",
          description: "Set coursework for a section. Students hand it in online and you grade it here.",
          action: newButton,
        }}
      />

      <AssignmentDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        assignment={editing === "new" ? null : editing}
        defaultSectionId={sectionId || undefined}
        onSaved={(a) => {
          const created = editing === "new";
          setEditing(null);
          if (created) router.push(`/elearning/assignments/${a.id}`);
          else void reload();
        }}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        destructive
        loading={busy}
        title={`Delete ${removing?.title ?? "assignment"}?`}
        description={removing?.submittedCount ? `${removing.submittedCount} submissions and their grades are deleted too. This cannot be undone.` : "Students will no longer see it. This cannot be undone."}
        confirmLabel="Delete assignment"
        onConfirm={remove}
      />
    </div>
  );
}
