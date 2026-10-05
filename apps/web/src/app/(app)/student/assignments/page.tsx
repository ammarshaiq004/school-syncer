"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CircleCheck, ClipboardList, Clock, Send, TriangleAlert } from "lucide-react";
import { ASSIGNMENT_STATE, dueText } from "@/components/student/format";
import { ASSIGNMENT_AVERAGE_HINT, assignmentAverage, dateTime, timeLeft, URGENCY } from "@/components/student-learning/format";
import type { StudentAssignmentItem } from "@/components/student-learning/types";
import {
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  KpiCard,
  NativeSelect,
  PageHeader,
  SkeletonRows,
  StatGrid,
  StatusPill,
  TabPanel,
  Tabs,
  type Column,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { useApi } from "@/lib/use-api";

type TabId = "todo" | "submitted" | "graded" | "missing";

const TAB_OF = (a: StudentAssignmentItem): TabId =>
  a.state === "submitted" ? "submitted" : a.state === "graded" ? "graded" : a.state === "missing" ? "missing" : "todo";

const EMPTY: Record<TabId, { title: string; description: string }> = {
  todo: { title: "All caught up", description: "You have no work to hand in right now." },
  submitted: { title: "Nothing waiting for a grade", description: "Work you hand in shows here until your teacher grades it." },
  graded: { title: "No graded work yet", description: "Grades and teacher feedback appear here." },
  missing: { title: "No missing work", description: "Well done. Nothing has passed its due date without a submission." },
};

/** "Science" or "Science, Living things" — the course title only when it adds something. */
const subtitle = (a: StudentAssignmentItem) =>
  a.course && a.course.title !== a.subject.name ? `${a.subject.name}, ${a.course.title}` : a.subject.name;

/** Short due line: "Due Wed, 7 Oct, 47 h left" while open, else the full date and time. */
const dueLine = (a: StudentAssignmentItem) => (a.urgency ? `${dueText(a.dueAt)}, ${timeLeft(a.hoursLeft)}` : dateTime(a.dueAt));

/** One assignment as a card, for phones where the table's columns do not fit. */
function AssignmentCard({ a }: { a: StudentAssignmentItem }) {
  const s = ASSIGNMENT_STATE[a.state];
  const pressing = a.urgency === "overdue" || a.urgency === "today";
  return (
    <Link
      href={`/student/assignments/${a.id}`}
      className={cn(
        "flex flex-col gap-1.5 rounded-xl border p-3.5 transition-colors",
        a.urgency === "overdue" ? "border-danger/40 bg-danger-tint/30" : "border-border bg-surface hover:border-border-strong",
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0 text-sm font-medium text-fg">{a.title}</span>
        <span className="flex shrink-0 flex-wrap items-center gap-1.5">
          <StatusPill status={a.state} label={s.label} tone={s.tone} />
          {a.submission?.isLate && <StatusPill status="LATE" label="Late" />}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-fg-muted">
        <span className="min-w-0 truncate">{subtitle(a)}</span>
        <span aria-hidden>·</span>
        <span className={cn("tabular-nums", pressing && "font-medium text-danger-text")}>{dueLine(a)}</span>
        {a.submission?.points != null && (
          <>
            <span aria-hidden>·</span>
            <span className="font-medium text-fg">
              {a.submission.points}/{a.maxPoints}
            </span>
          </>
        )}
      </span>
    </Link>
  );
}

/** Student assignments: to do (by urgency), handed in, graded and missing, with points and feedback. */
export default function StudentAssignmentsPage() {
  const router = useRouter();
  const { data, error, reload } = useApi<StudentAssignmentItem[]>("/student/assignments");
  const [tab, setTab] = useState<TabId>("todo");
  const [subject, setSubject] = useState("");

  const subjects = Array.from(new Map((data ?? []).map((a) => [a.subject.id, a.subject.name])).entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const rows = (data ?? []).filter((a) => !subject || a.subject.id === subject);
  const byTab = (t: TabId) => rows.filter((a) => TAB_OF(a) === t);
  const count = (t: TabId) => (data ? byTab(t).length : undefined);

  const todo = data?.filter((a) => TAB_OF(a) === "todo") ?? [];
  const dueSoon = todo.filter((a) => a.urgency === "today" || a.urgency === "overdue").length;
  // Marked work is anything with points, graded or returned: the same set the
  // grades page averages, with the same formula (see assignmentAverage).
  const marked = data?.filter((a) => a.submission?.points != null) ?? [];
  const avgRaw = assignmentAverage(marked.map((a) => ({ points: a.submission!.points, maxPoints: a.maxPoints })));
  const avg = avgRaw == null ? null : Math.round(avgRaw * 10) / 10;

  const columns: Column<StudentAssignmentItem>[] = [
    {
      id: "title",
      header: "Assignment",
      sortValue: (r) => r.title,
      cell: (r) => (
        <span className="block min-w-0">
          <Link href={`/student/assignments/${r.id}`} className="block truncate font-medium text-fg hover:text-brand">
            {r.title}
          </Link>
          <span className="block truncate text-xs text-fg-muted">{subtitle(r)}</span>
        </span>
      ),
    },
    {
      id: "due",
      header: "Due",
      sortValue: (r) => r.dueAt,
      cell: (r) => {
        const open = r.urgency !== null;
        const u = r.urgency ? URGENCY[r.urgency] : null;
        return (
          <span className="block">
            <span className={cn("block tabular-nums", r.urgency === "overdue" || r.urgency === "today" ? "font-medium text-danger-text" : "text-fg-secondary")}>
              {open ? dueText(r.dueAt) : dateTime(r.dueAt)}
            </span>
            {open && u && (
              <span className="flex items-center gap-1 text-xs text-fg-muted">
                <Clock className="size-3" aria-hidden />
                {timeLeft(r.hoursLeft)}
              </span>
            )}
          </span>
        );
      },
    },
    {
      id: "status",
      header: "Status",
      sortValue: (r) => r.state,
      cell: (r) => {
        const s = ASSIGNMENT_STATE[r.state];
        return (
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusPill status={r.state} label={s.label} tone={s.tone} />
            {r.submission?.isLate && <StatusPill status="LATE" label="Late" />}
          </span>
        );
      },
    },
    {
      id: "points",
      header: "Points",
      align: "right",
      hideBelow: "sm",
      sortValue: (r) => (r.submission?.points != null ? r.submission.points / r.maxPoints : -1),
      cell: (r) =>
        r.submission?.points != null ? (
          <span className="font-medium text-fg">
            {r.submission.points}
            <span className="text-fg-muted">/{r.maxPoints}</span>
          </span>
        ) : (
          <span className="text-fg-muted">{r.maxPoints} max</span>
        ),
    },
  ];

  const tabs: { value: TabId; label: string; count?: number }[] = [
    { value: "todo", label: "To do", count: count("todo") },
    { value: "submitted", label: "Handed in", count: count("submitted") },
    { value: "graded", label: "Graded", count: count("graded") },
    { value: "missing", label: "Missing", count: count("missing") },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Assignments"
        description="Hand in your work before the due date. Grades and feedback from your teachers show up here."
        breadcrumbs={[{ label: "Student Workspace", href: "/student" }, { label: "Assignments" }]}
      />

      {error && !data ? (
        <Card padding="none">
          <ErrorState message={error} onRetry={reload} />
        </Card>
      ) : (
        <>
          <StatGrid>
            <KpiCard label="To do" value={todo.length} loading={!data} icon={<ClipboardList />} tone="primary" hint={todo.length ? `${todo.length} to hand in` : "Nothing to hand in"} />
            <KpiCard label="Due today or overdue" value={dueSoon} loading={!data} icon={<TriangleAlert />} tone={dueSoon ? "danger" : "success"} />
            <KpiCard label="Waiting for a grade" value={data?.filter((a) => a.state === "submitted").length ?? 0} loading={!data} icon={<Send />} tone="info" />
            <KpiCard
              label="Average grade"
              value={avg == null ? "None yet" : `${avg}%`}
              loading={!data}
              icon={<CircleCheck />}
              tone={avg == null ? "neutral" : avg >= 70 ? "success" : "warning"}
              hint={marked.length ? `${ASSIGNMENT_AVERAGE_HINT}, across ${marked.length} marked` : undefined}
            />
          </StatGrid>

          {/* The tab strip scrolls sideways on a phone; the fade shows there is more to its right. */}
          <Tabs
            tabs={tabs}
            value={tab}
            onValueChange={(v) => setTab(v as TabId)}
            aria-label="Assignments by status"
            listClassName="[mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)] md:[mask-image:none]"
          >
            {tabs.map((t) => (
              <TabPanel key={t.value} value={t.value}>
                {/* Phones: a card list, because the table's Due and Status columns are cut off below md. */}
                <div className="flex flex-col gap-2.5 md:hidden">
                  {subjects.length > 1 && (
                    <NativeSelect
                      aria-label="Subject"
                      placeholder="All subjects"
                      options={subjects}
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                    />
                  )}
                  {!data ? (
                    <SkeletonRows rows={4} columns={1} />
                  ) : byTab(t.value).length === 0 ? (
                    <Card padding="none">
                      <EmptyState icon={<ClipboardList />} title={EMPTY[t.value].title} description={EMPTY[t.value].description} compact />
                    </Card>
                  ) : (
                    byTab(t.value).map((a) => <AssignmentCard key={a.id} a={a} />)
                  )}
                </div>
                <div className="hidden md:block">
                  <DataTable
                    label={`${t.label} assignments`}
                    columns={columns}
                    data={data ? byTab(t.value) : null}
                    getRowId={(r) => r.id}
                    defaultSort={t.value === "todo" ? { id: "due", dir: "asc" } : { id: "due", dir: "desc" }}
                    getSearchText={(r) => `${r.title} ${r.subject.name} ${r.course?.title ?? ""}`}
                    searchPlaceholder="Search assignments"
                    filters={
                      subjects.length > 1 && (
                        <NativeSelect
                          aria-label="Subject"
                          placeholder="All subjects"
                          options={subjects}
                          value={subject}
                          onChange={(e) => setSubject(e.target.value)}
                          wrapperClassName="w-44"
                        />
                      )
                    }
                    filtered={!!subject}
                    onRowClick={(r) => router.push(`/student/assignments/${r.id}`)}
                    getRowLabel={(r) => r.title}
                    rowClassName={(r) => (r.urgency === "overdue" ? "bg-danger-tint/30" : undefined)}
                    empty={EMPTY[t.value]}
                  />
                </div>
              </TabPanel>
            ))}
          </Tabs>
        </>
      )}
    </div>
  );
}
