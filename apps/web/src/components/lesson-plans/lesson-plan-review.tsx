"use client";

import { useState } from "react";
import { CircleCheck, ClipboardCheck, FilePen, Hourglass, MessageSquareWarning } from "lucide-react";
import { Avatar, Button, DataTable, KpiCard, StatGrid, type Column } from "@/components/ui";
import { LessonPlanDrawer } from "./lesson-plan-drawer";
import { weekShort, when, type LessonPlan, type PlanSection, type ReviewQueue } from "./lesson-plan-types";

interface Props {
  queue: { data: ReviewQueue | null; error: string; reload: () => void };
  sections: PlanSection[];
  canManage: boolean;
}

/** Admin review queue: submitted plans, oldest first, opened in a drawer to approve or send back. */
export function LessonPlanReview({ queue, sections, canManage }: Props) {
  const [drawer, setDrawer] = useState<{ plan: LessonPlan; n: number } | null>(null);
  const [open, setOpen] = useState(false);
  const show = (plan: LessonPlan) => {
    setDrawer((d) => ({ plan, n: (d?.n ?? 0) + 1 }));
    setOpen(true);
  };
  const counts = queue.data?.counts;
  const loading = !queue.data && !queue.error;

  const columns: Column<LessonPlan>[] = [
    {
      id: "teacher",
      header: "Teacher",
      sortValue: (p) => p.teacher?.name ?? "",
      cell: (p) => (
        <span className="flex items-center gap-2.5">
          <Avatar name={p.teacher?.name ?? "Former staff"} size="xs" />
          <span className="font-medium text-fg">{p.teacher?.name ?? "Former staff member"}</span>
        </span>
      ),
    },
    {
      id: "topic",
      header: "Topic",
      sortValue: (p) => p.topic,
      cell: (p) => (
        <span className="flex min-w-0 flex-col">
          <span className="max-w-72 truncate text-fg">{p.topic}</span>
          <span className="text-xs text-fg-muted">
            {p.subjectName}, {p.sectionName}
          </span>
        </span>
      ),
    },
    { id: "week", header: "Week", sortValue: (p) => p.weekStart, cell: (p) => weekShort(p.weekStart), hideBelow: "md" },
    { id: "submitted", header: "Sent", sortValue: (p) => p.submittedAt ?? "", cell: (p) => (p.submittedAt ? when(p.submittedAt) : "-"), hideBelow: "lg" },
    {
      id: "action",
      header: <span className="sr-only">Actions</span>,
      width: "110px",
      align: "right",
      cell: (p) => (
        <Button type="button" size="sm" variant="secondary" onClick={() => show(p)} aria-label={`Review ${p.topic} by ${p.teacher?.name ?? "former staff member"}`}>
          Review
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <StatGrid>
        <KpiCard label="Awaiting review" value={counts?.SUBMITTED ?? 0} icon={<Hourglass />} tone="info" loading={loading} />
        <KpiCard label="Needs changes" value={counts?.NEEDS_CHANGES ?? 0} icon={<MessageSquareWarning />} tone="warning" loading={loading} hint="Sent back to teachers" />
        <KpiCard label="Approved" value={counts?.APPROVED ?? 0} icon={<CircleCheck />} tone="success" loading={loading} />
        <KpiCard label="Drafts" value={counts?.DRAFT ?? 0} icon={<FilePen />} tone="neutral" loading={loading} hint="Not sent yet" />
      </StatGrid>

      <DataTable
        label="Lesson plans awaiting review"
        columns={columns}
        data={queue.data?.items ?? null}
        error={queue.error}
        onRetry={queue.reload}
        getRowId={(p) => p.id}
        getSearchText={(p) => `${p.teacher?.name ?? ""} ${p.topic} ${p.subjectName} ${p.sectionName}`}
        searchPlaceholder="Search teacher, topic or class"
        onRowClick={show}
        getRowLabel={(p) => `${p.topic} by ${p.teacher?.name ?? "former staff member"}`}
        empty={{ title: "Nothing to review", description: "Plans teachers send for review will wait here, oldest first.", icon: <ClipboardCheck /> }}
      />

      {drawer && (
        <LessonPlanDrawer
          key={drawer.n}
          open={open}
          onOpenChange={setOpen}
          plan={drawer.plan}
          defaults={{ sectionId: drawer.plan.sectionId, subjectId: drawer.plan.subjectId, weekStart: drawer.plan.weekStart }}
          sections={sections}
          canManage={canManage}
          canReview={canManage}
          onChanged={() => queue.reload()}
        />
      )}
    </div>
  );
}
