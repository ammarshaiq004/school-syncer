"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ChartColumn, CircleHelp, Ellipsis, ListChecks, PenLine, Plus, Timer, Trash2, Users } from "lucide-react";
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
import { CreateQuizDialog } from "@/components/elearning/assess-quiz-dialog";
import { pct, WINDOW_LABEL, whenText, type QuizRow, type QuizWindow } from "@/components/elearning/assess-types";
import { sectionName } from "@/components/elearning/courses-types";
import { api } from "@/lib/api";
import { useCan } from "@/lib/session";
import { useApi } from "@/lib/use-api";

type StatusFilter = "" | QuizWindow | "draft" | "review";

const WINDOW_TONE: Record<QuizWindow, "success" | "info" | "neutral"> = { open: "success", upcoming: "info", closed: "neutral" };

function windowHint(q: QuizRow) {
  if (q.window === "upcoming" && q.opensAt) return `Opens ${whenText(q.opensAt)}`;
  if (q.window === "open" && q.closesAt) return `Closes ${whenText(q.closesAt)}`;
  if (q.window === "closed" && q.closesAt) return `Closed ${whenText(q.closesAt)}`;
  return q.window === "open" ? "No closing time" : "";
}

export default function QuizzesPage() {
  const router = useRouter();
  const toast = useToast();
  const can = useCan();
  const canManage = can("elearning", "manage");
  const { data, error, reload } = useApi<QuizRow[]>("/elearning/quizzes");
  const [sectionId, setSectionId] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<QuizRow | null>(null);
  const [busy, setBusy] = useState(false);

  const sectionOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const q of data ?? []) map.set(q.sectionId, sectionName(q.section));
    return [...map].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  }, [data]);

  const rows = useMemo(
    () =>
      (data ?? []).filter((q) => {
        if (sectionId && q.sectionId !== sectionId) return false;
        if (status === "draft") return !q.isPublished;
        if (status === "review") return q.needsReviewCount > 0;
        if (status) return q.isPublished && q.window === status;
        return true;
      }),
    [data, sectionId, status],
  );

  const totals = useMemo(() => {
    const list = data ?? [];
    const scored = list.filter((q) => q.avgPercent != null);
    return {
      open: list.filter((q) => q.isPublished && q.window === "open").length,
      drafts: list.filter((q) => !q.isPublished).length,
      review: list.reduce((n, q) => n + q.needsReviewCount, 0),
      attempts: list.reduce((n, q) => n + q.attemptCount, 0),
      avg: scored.length ? scored.reduce((n, q) => n + (q.avgPercent ?? 0), 0) / scored.length : null,
    };
  }, [data]);

  async function togglePublish(q: QuizRow) {
    try {
      await api(`/elearning/quizzes/${q.id}/publish`, { method: "PUT", body: { isPublished: !q.isPublished } });
      toast.success(q.isPublished ? "Moved to draft" : "Quiz published", q.title);
      await reload();
    } catch (e) {
      toast.error("Could not update quiz", (e as Error).message);
    }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api(`/elearning/quizzes/${removing.id}`, { method: "DELETE" });
      toast.success("Quiz deleted", removing.title);
      setRemoving(null);
      await reload();
    } catch (e) {
      toast.error("Could not delete quiz", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<QuizRow>[] = [
    {
      id: "title",
      header: "Quiz",
      sortValue: (q) => q.title,
      cell: (q) => (
        <div className="min-w-0">
          <Link href={`/elearning/quizzes/${q.id}`} className="font-medium text-fg hover:text-brand">
            {q.title}
          </Link>
          <p className="truncate text-xs text-fg-muted">
            {q.subject.name} · {q.questionCount} {q.questionCount === 1 ? "question" : "questions"}, {q.totalPoints} {q.totalPoints === 1 ? "point" : "points"}
            {q.timeLimitMin ? ` · ${q.timeLimitMin} min` : ""}
          </p>
        </div>
      ),
    },
    { id: "section", header: "Section", sortValue: (q) => sectionName(q.section), cell: (q) => sectionName(q.section) },
    {
      id: "window",
      header: "Window",
      hideBelow: "md",
      sortValue: (q) => q.opensAt ?? q.createdAt,
      cell: (q) =>
        q.isPublished ? (
          <div className="flex flex-col items-start gap-0.5">
            <StatusPill status={q.window} tone={WINDOW_TONE[q.window]} label={WINDOW_LABEL[q.window]} />
            <span className="text-xs text-fg-muted">{windowHint(q)}</span>
          </div>
        ) : (
          <StatusPill status="DRAFT" />
        ),
    },
    {
      id: "attempted",
      header: "Attempted",
      width: "150px",
      hideBelow: "sm",
      sortValue: (q) => (q.studentCount ? q.studentsAttempted / q.studentCount : 0),
      cell: (q) => <ProgressBar value={q.studentsAttempted} max={q.studentCount || 1} size="sm" valueText={`${q.studentsAttempted}/${q.studentCount}`} label={<span className="sr-only">Students attempted</span>} />,
    },
    { id: "avg", header: "Average", align: "right", sortValue: (q) => q.avgPercent ?? -1, cell: (q) => pct(q.avgPercent) },
    {
      id: "review",
      header: "To review",
      align: "right",
      hideBelow: "lg",
      sortValue: (q) => q.needsReviewCount,
      cell: (q) => (q.needsReviewCount ? <Badge tone="warning">{q.needsReviewCount}</Badge> : <span className="text-fg-muted">0</span>),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      width: "48px",
      cell: (q) =>
        q.canManage ? (
          <DropdownMenu trigger={<IconButton size="sm" aria-label={`Actions for ${q.title}`}><Ellipsis /></IconButton>}>
            <DropdownItem icon={<PenLine />} href={`/elearning/quizzes/${q.id}`}>
              Edit questions
            </DropdownItem>
            <DropdownItem icon={<ChartColumn />} href={`/elearning/quizzes/${q.id}?tab=results`}>
              View results
            </DropdownItem>
            <DropdownItem
              icon={<ListChecks />}
              onSelect={() => void togglePublish(q)}
              disabled={!q.isPublished && q.questionCount === 0}
              disabledReason="Add at least one question first"
            >
              {q.isPublished ? "Move to draft" : "Publish"}
            </DropdownItem>
            <DropdownSeparator />
            <DropdownItem icon={<Trash2 />} danger onSelect={() => setRemoving(q)}>
              Delete
            </DropdownItem>
          </DropdownMenu>
        ) : null,
    },
  ];

  const loading = !data && !error;
  const newButton = canManage ? (
    <Button icon={<Plus />} onClick={() => setCreating(true)}>
      New quiz
    </Button>
  ) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Quizzes"
        description="Online quizzes are marked automatically. Short answers that do not match are left for you to review."
        breadcrumbs={[{ label: "E-school", href: "/elearning" }, { label: "Quizzes" }]}
        actions={newButton}
      />

      <StatGrid>
        <KpiCard label="Open now" value={totals.open} icon={<Timer />} tone="success" loading={loading} error={!!error} hint={`${totals.drafts} in draft`} />
        <KpiCard label="Attempts submitted" value={totals.attempts} icon={<Users />} tone="info" loading={loading} error={!!error} hint="Across all quizzes" />
        <KpiCard label="Answers to review" value={totals.review} icon={<CircleHelp />} tone={totals.review ? "warning" : "success"} loading={loading} error={!!error} hint="Short answers that need a teacher" />
        <KpiCard label="Average score" value={pct(totals.avg)} icon={<ChartColumn />} tone="primary" loading={loading} error={!!error} hint="Best attempt per student" />
      </StatGrid>

      <DataTable
        label="Quizzes"
        columns={columns}
        data={data ? rows : null}
        error={error}
        onRetry={reload}
        getRowId={(q) => q.id}
        getSearchText={(q) => `${q.title} ${q.subject.name} ${sectionName(q.section)} ${q.course?.title ?? ""}`}
        searchPlaceholder="Search title, subject or section"
        filters={
          <>
            <NativeSelect aria-label="Section" placeholder="All sections" options={sectionOptions} value={sectionId} onChange={(e) => setSectionId(e.target.value)} wrapperClassName="w-40" />
            <NativeSelect
              aria-label="Status"
              placeholder="All quizzes"
              options={[
                { value: "open", label: "Open now" },
                { value: "upcoming", label: "Upcoming" },
                { value: "closed", label: "Closed" },
                { value: "draft", label: "Draft" },
                { value: "review", label: "Has answers to review" },
              ]}
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
              wrapperClassName="w-48"
            />
          </>
        }
        filtered={!!(sectionId || status)}
        onRowClick={(q) => router.push(`/elearning/quizzes/${q.id}`)}
        getRowLabel={(q) => q.title}
        empty={{
          title: "No quizzes yet",
          description: "Build a quiz with multiple choice, true or false and short answer questions. Students take it online and see their score straight away.",
          action: newButton,
        }}
      />

      <CreateQuizDialog
        open={creating}
        onOpenChange={setCreating}
        defaultSectionId={sectionId || undefined}
        onCreated={(q) => {
          setCreating(false);
          router.push(`/elearning/quizzes/${q.id}`);
        }}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        destructive
        loading={busy}
        title={`Delete ${removing?.title ?? "quiz"}?`}
        description={removing?.attemptCount ? `${removing.attemptCount} student attempts and their scores are deleted too. This cannot be undone.` : "Its questions are deleted too. This cannot be undone."}
        confirmLabel="Delete quiz"
        onConfirm={remove}
      />
    </div>
  );
}
