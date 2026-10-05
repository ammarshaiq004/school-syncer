"use client";

import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CircleCheck, ClipboardCheck, Clock, Ellipsis, ExternalLink, Pencil, Trash2, UserX } from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  DataTable,
  DescriptionList,
  DropdownItem,
  DropdownMenu,
  ErrorState,
  IconButton,
  KpiCard,
  PageHeader,
  SegmentedControl,
  SkeletonRows,
  StatGrid,
  StatusPill,
  Switch,
  useToast,
  type Column,
} from "@/components/ui";
import { AssignmentDialog } from "@/components/elearning/assess-assignment-dialog";
import { GradeDrawer } from "@/components/elearning/assess-grade-drawer";
import { FileChip } from "@/components/elearning/file-upload";
import { WORK_STATE, whenText, type AssignmentRow, type StudentWorkState, type SubmissionRow, type SubmissionsResponse } from "@/components/elearning/assess-types";
import { sectionName } from "@/components/elearning/courses-types";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";

type View = "all" | "to_grade" | "graded" | "not_in";

const VIEW_STATES: Record<View, StudentWorkState[] | null> = {
  all: null,
  to_grade: ["submitted"],
  graded: ["graded", "returned"],
  not_in: ["pending", "overdue", "missing"],
};

export default function AssignmentSubmissionsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { data, error, errorStatus, reload: reloadSubmissions } = useApi<SubmissionsResponse>(`/elearning/assignments/${id}/submissions`);
  // The submissions payload carries the assignment without permissions; the detail adds canManage and counts.
  const detail = useApi<AssignmentRow>(`/elearning/assignments/${id}`);
  const reload = () => Promise.all([reloadSubmissions(), detail.reload()]);
  const [view, setView] = useState<View>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const rows = useMemo(() => {
    const states = VIEW_STATES[view];
    return (data?.students ?? []).filter((r) => !states || states.includes(r.state));
  }, [data, view]);

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Assignment" breadcrumbs={[{ label: "Assignments", href: "/elearning/assignments" }, { label: "Assignment" }]} />
        <ErrorState
          title={errorStatus === 404 ? "Assignment not found" : undefined}
          message={errorStatus === 404 ? "It may have been deleted, or it belongs to a section you do not teach." : error}
          onRetry={errorStatus === 404 ? undefined : reload}
        />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Loading assignment" breadcrumbs={[{ label: "Assignments", href: "/elearning/assignments" }, { label: "Assignment" }]} />
        <SkeletonRows rows={8} />
      </div>
    );
  }

  const a = detail.data ?? data.assignment;
  const canManage = detail.data?.canManage ?? false;
  const s = data.summary;
  const openRow = data.students.find((r) => r.student.id === openId) ?? null;
  // "Next" walks the rows currently shown, so a teacher can grade straight through the To grade list.
  const order = rows.map((r) => r.student.id);
  const nextId = openId ? order[order.indexOf(openId) + 1] : undefined;

  async function setPublished(on: boolean) {
    setBusy("publish");
    try {
      await api(`/elearning/assignments/${a.id}`, { method: "PATCH", body: { isPublished: on } });
      toast.success(on ? "Assignment published" : "Moved to draft", a.title);
      await reload();
    } catch (e) {
      toast.error("Could not update assignment", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("remove");
    try {
      await api(`/elearning/assignments/${a.id}`, { method: "DELETE" });
      toast.success("Assignment deleted", a.title);
      router.push("/elearning/assignments");
    } catch (e) {
      toast.error("Could not delete assignment", (e as Error).message);
      setBusy(null);
    }
  }

  const columns: Column<SubmissionRow>[] = [
    {
      id: "roll",
      header: "Roll",
      width: "64px",
      align: "right",
      hideBelow: "sm",
      sortValue: (r) => r.student.rollNo ?? 9999,
      cell: (r) => r.student.rollNo ?? <span className="text-fg-muted">–</span>,
    },
    {
      id: "student",
      header: "Student",
      sortValue: (r) => r.student.name,
      cell: (r) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={r.student.name} src={r.student.photoUrl ?? undefined} size="sm" />
          <div className="min-w-0">
            <p className="truncate font-medium text-fg">{r.student.name}</p>
            <p className="truncate text-xs text-fg-muted">{r.student.admissionNo}</p>
          </div>
        </div>
      ),
    },
    {
      id: "state",
      header: "Status",
      sortValue: (r) => r.state,
      cell: (r) => <StatusPill status={r.state} tone={WORK_STATE[r.state].tone} label={WORK_STATE[r.state].label} />,
    },
    {
      id: "submitted",
      header: "Handed in",
      hideBelow: "md",
      sortValue: (r) => r.submission?.submittedAt ?? "",
      cell: (r) =>
        r.submission ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            {whenText(r.submission.submittedAt)}
            {r.submission.isLate && <Badge tone="danger">Late</Badge>}
          </span>
        ) : (
          <span className="text-fg-muted">Not yet</span>
        ),
    },
    {
      id: "points",
      header: "Points",
      align: "right",
      sortValue: (r) => r.submission?.points ?? -1,
      cell: (r) => (r.submission?.points != null ? `${r.submission.points}/${a.maxPoints}` : <span className="text-fg-muted">–</span>),
    },
    {
      id: "feedback",
      header: "Feedback",
      hideBelow: "lg",
      cell: (r) => <span className="line-clamp-1 max-w-64 text-fg-secondary">{r.submission?.feedback ?? ""}</span>,
    },
    {
      id: "action",
      header: <span className="sr-only">Action</span>,
      width: "96px",
      align: "right",
      cell: (r) =>
        r.submission ? (
          <Button size="sm" variant={r.state === "submitted" ? "primary" : "secondary"} onClick={() => setOpenId(r.student.id)} aria-label={`${r.state === "submitted" ? "Grade" : "Open"} work by ${r.student.name}`}>
            {r.state === "submitted" ? "Grade" : "Open"}
          </Button>
        ) : null,
    },
  ];

  const handedIn = s.submitted;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={a.title}
        description={`${sectionName(a.section)} · ${a.subject.name} · Due ${whenText(a.dueAt)}`}
        breadcrumbs={[{ label: "E-school", href: "/elearning" }, { label: "Assignments", href: "/elearning/assignments" }, { label: a.title }]}
        meta={<StatusPill status={a.isPublished ? "PUBLISHED" : "DRAFT"} />}
        actions={
          canManage && (
            <>
              <Switch checked={a.isPublished} disabled={busy === "publish"} onCheckedChange={(on) => void setPublished(on)} label="Visible to students" />
              <Button variant="secondary" icon={<Pencil />} onClick={() => setEditing(true)}>
                Edit
              </Button>
              <DropdownMenu trigger={<IconButton variant="secondary" aria-label="More assignment actions"><Ellipsis /></IconButton>}>
                <DropdownItem icon={<Trash2 />} danger onSelect={() => setRemoving(true)}>
                  Delete assignment
                </DropdownItem>
              </DropdownMenu>
            </>
          )
        }
      />

      <StatGrid>
        <KpiCard label="Handed in" value={`${handedIn}/${s.students}`} icon={<ClipboardCheck />} tone="primary" hint={s.late ? `${s.late} late` : "None late"} />
        <KpiCard label="To grade" value={s.toGrade} icon={<Clock />} tone={s.toGrade ? "warning" : "success"} hint={s.toGrade ? "Waiting for you" : "All caught up"} />
        <KpiCard label="Graded" value={s.graded} icon={<CircleCheck />} tone="success" hint="Including returned work" />
        <KpiCard label="Not handed in" value={s.missing + s.pending} icon={<UserX />} tone={s.missing ? "danger" : "neutral"} hint={s.missing ? `${s.missing} past the due time` : "Still before the due time"} />
      </StatGrid>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <DataTable
            label="Submissions"
            columns={columns}
            data={rows}
            getRowId={(r) => r.student.id}
            getSearchText={(r) => `${r.student.name} ${r.student.admissionNo}`}
            searchPlaceholder="Search student or admission no."
            filters={
              <SegmentedControl<View>
                aria-label="Show"
                value={view}
                onChange={setView}
                options={[
                  { value: "all", label: `All ${s.students}` },
                  { value: "to_grade", label: `To grade ${s.toGrade}` },
                  { value: "graded", label: `Graded ${s.graded}` },
                  { value: "not_in", label: `Not in ${s.missing + s.pending}` },
                ]}
              />
            }
            filtered={view !== "all"}
            defaultSort={{ id: "roll", dir: "asc" }}
            pageSize={0}
            onRowClick={(r) => r.submission && setOpenId(r.student.id)}
            getRowLabel={(r) => r.student.name}
            empty={{ title: "No students in this section", description: "Enrol students in the section and they will appear here." }}
          />
        </div>
        <Card>
          <CardHeader title="Assignment details" />
          <DescriptionList
            columns={1}
            items={[
              { label: "Due", value: whenText(a.dueAt) },
              { label: "Points", value: a.maxPoints },
              { label: "Late work", value: a.allowLate ? "Accepted, marked late" : "Not accepted after the due time" },
              ...(a.course ? [{ label: "Course", value: a.course.title }] : []),
              ...(a.createdBy ? [{ label: "Set by", value: a.createdBy.name }] : []),
            ]}
          />
          {a.attachment && <FileChip file={a.attachment} className="mt-4" />}
          {a.attachmentUrl && (
            <a
              href={a.attachmentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-brand hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
            >
              <ExternalLink className="size-4" aria-hidden />
              Open attachment
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
          <div className="mt-4 border-t border-border pt-4">
            <h3 className="text-[13px] font-medium text-fg-muted">Instructions</h3>
            <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-fg">{a.instructions || "No instructions added."}</p>
          </div>
        </Card>
      </div>

      <GradeDrawer
        assignment={a}
        row={openRow}
        hasNext={!!nextId}
        onClose={() => setOpenId(null)}
        onSaved={reload}
        onNext={() => nextId && setOpenId(nextId)}
      />
      <AssignmentDialog
        open={editing}
        onOpenChange={setEditing}
        assignment={a}
        onSaved={() => {
          setEditing(false);
          void reload();
        }}
      />
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        destructive
        loading={busy === "remove"}
        title={`Delete ${a.title}?`}
        description={handedIn ? `${handedIn} submissions and their grades are deleted too. This cannot be undone.` : "Students will no longer see it. This cannot be undone."}
        confirmLabel="Delete assignment"
        onConfirm={remove}
      />
    </div>
  );
}
