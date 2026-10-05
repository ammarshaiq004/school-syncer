"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { BookOpen, LayoutGrid, List, Plus, Sparkles, Users } from "lucide-react";
import {
  Avatar,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  NativeSelect,
  PageHeader,
  ProgressBar,
  SearchInput,
  SegmentedControl,
  SkeletonCards,
  StatusPill,
  Toolbar,
  ToolbarSpacer,
  type Column,
} from "@/components/ui";
import { CreateCourseDialog, GenerateCoursesDialog } from "@/components/elearning/courses-create-dialog";
import { courseColor, sectionName, type CourseSummary } from "@/components/elearning/courses-types";
import { usePersistedState } from "@/lib/persisted";
import { useCan } from "@/lib/session";
import { useApi } from "@/lib/use-api";

type Layout = "grid" | "list";
type StatusFilter = "" | "published" | "draft";

export default function CoursesPage() {
  const router = useRouter();
  const can = useCan();
  const canManage = can("elearning", "manage");
  const { data, error, reload } = useApi<CourseSummary[]>("/elearning/courses");
  const [layout, setLayout] = usePersistedState<Layout>("schoolsyncer.courses.layout", "grid");
  const [search, setSearch] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [creating, setCreating] = useState(false);
  const [generating, setGenerating] = useState(false);

  const sectionOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of data ?? []) map.set(c.sectionId, sectionName(c.section));
    return [...map].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  }, [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data ?? []).filter(
      (c) =>
        (!sectionId || c.sectionId === sectionId) &&
        (!status || (status === "published") === c.isPublished) &&
        (!q || `${c.title} ${c.subject.name} ${sectionName(c.section)} ${c.teacher?.name ?? ""}`.toLowerCase().includes(q)),
    );
  }, [data, search, sectionId, status]);

  const filters = (
    <>
      <NativeSelect aria-label="Section" placeholder="All sections" options={sectionOptions} value={sectionId} onChange={(e) => setSectionId(e.target.value)} wrapperClassName="w-40" />
      <NativeSelect
        aria-label="Status"
        placeholder="All statuses"
        options={[
          { value: "published", label: "Published" },
          { value: "draft", label: "Draft" },
        ]}
        value={status}
        onChange={(e) => setStatus(e.target.value as StatusFilter)}
        wrapperClassName="w-36"
      />
    </>
  );

  const columns: Column<CourseSummary>[] = [
    {
      id: "title",
      header: "Course",
      sortValue: (c) => c.title,
      cell: (c) => (
        <Link href={`/elearning/courses/${c.id}`} className="flex items-center gap-2.5 font-medium text-fg hover:text-brand">
          <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: courseColor(c) }} />
          {c.title}
        </Link>
      ),
    },
    { id: "section", header: "Section", sortValue: (c) => sectionName(c.section), cell: (c) => sectionName(c.section) },
    { id: "teacher", header: "Teacher", hideBelow: "md", sortValue: (c) => c.teacher?.name ?? "", cell: (c) => c.teacher?.name ?? <span className="text-fg-muted">Not assigned</span> },
    { id: "lessons", header: "Lessons", align: "right", sortValue: (c) => c.lessonCount, cell: (c) => `${c.publishedLessonCount}/${c.lessonCount}` },
    { id: "students", header: "Students", align: "right", hideBelow: "lg", sortValue: (c) => c.studentCount, cell: (c) => c.studentCount },
    {
      id: "completion",
      header: "Completion",
      width: "160px",
      hideBelow: "sm",
      sortValue: (c) => c.avgCompletion,
      cell: (c) => <ProgressBar value={c.avgCompletion} size="sm" showValue label={<span className="sr-only">Average completion</span>} />,
    },
    { id: "status", header: "Status", sortValue: (c) => (c.isPublished ? 1 : 0), cell: (c) => <StatusPill status={c.isPublished ? "PUBLISHED" : "DRAFT"} /> },
  ];

  const emptyAction = canManage ? (
    <Button icon={<Plus />} onClick={() => setCreating(true)}>
      New course
    </Button>
  ) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Courses"
        description="Units and lessons for each subject. Students only see published courses and lessons."
        breadcrumbs={[{ label: "E-school", href: "/elearning" }, { label: "Courses" }]}
        actions={
          canManage && (
            <>
              <Button variant="secondary" icon={<Sparkles />} onClick={() => setGenerating(true)}>
                Create for a section
              </Button>
              <Button icon={<Plus />} onClick={() => setCreating(true)}>
                New course
              </Button>
            </>
          )
        }
      />

      {layout === "list" ? (
        <DataTable
          label="Courses"
          columns={columns}
          data={data ? filtered : null}
          error={error}
          onRetry={reload}
          getRowId={(c) => c.id}
          search={search}
          onSearchChange={setSearch}
          manualFiltering
          searchPlaceholder="Search course, subject or teacher"
          filters={filters}
          filtered={!!(sectionId || status || search)}
          toolbarActions={<LayoutToggle value={layout} onChange={setLayout} />}
          onRowClick={(c) => router.push(`/elearning/courses/${c.id}`)}
          getRowLabel={(c) => c.title}
          defaultSort={{ id: "section", dir: "asc" }}
          empty={{ title: "No courses yet", description: "Create a course for a subject, or create one for every subject of a section at once.", action: emptyAction }}
        />
      ) : (
        <>
          <Toolbar>
            <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} onClear={() => setSearch("")} placeholder="Search course, subject or teacher" wrapperClassName="w-full sm:w-72" />
            {filters}
            <ToolbarSpacer />
            <LayoutToggle value={layout} onChange={setLayout} />
          </Toolbar>
          {error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : !data ? (
            <SkeletonCards count={6} />
          ) : filtered.length === 0 ? (
            <Card padding="none">
              {data.length === 0 ? (
                <EmptyState icon={<BookOpen />} title="No courses yet" description="Create a course for a subject, or create one for every subject of a section at once." action={emptyAction} />
              ) : (
                <EmptyState title="No courses match" description="Try another section, status or search." />
              )}
            </Card>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((c) => (
                <li key={c.id}>
                  <CourseCard course={c} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <CreateCourseDialog
        open={creating}
        onOpenChange={setCreating}
        defaultSectionId={sectionId || undefined}
        onCreated={(c) => {
          setCreating(false);
          router.push(`/elearning/courses/${c.id}`);
        }}
      />
      <GenerateCoursesDialog open={generating} onOpenChange={setGenerating} onDone={reload} />
    </div>
  );
}

function LayoutToggle({ value, onChange }: { value: Layout; onChange: (v: Layout) => void }) {
  return (
    <SegmentedControl<Layout>
      aria-label="Layout"
      value={value}
      onChange={onChange}
      options={[
        { value: "grid", label: <span className="sr-only sm:not-sr-only">Cards</span>, icon: <LayoutGrid /> },
        { value: "list", label: <span className="sr-only sm:not-sr-only">Table</span>, icon: <List /> },
      ]}
    />
  );
}

function CourseCard({ course: c }: { course: CourseSummary }) {
  return (
    <Link
      href={`/elearning/courses/${c.id}`}
      className="group block h-full rounded-xl focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
      aria-label={`${c.title}, ${sectionName(c.section)}`}
    >
      <Card padding="none" interactive className="flex h-full flex-col overflow-hidden">
        <div aria-hidden className="h-1.5" style={{ backgroundColor: courseColor(c) }} />
        <div className="flex flex-1 flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-[0.04em] text-fg-muted">
                {sectionName(c.section)} · {c.subject.name}
              </p>
              <h2 className="mt-1 truncate text-base font-semibold text-fg group-hover:text-brand">{c.title}</h2>
            </div>
            <StatusPill status={c.isPublished ? "PUBLISHED" : "DRAFT"} />
          </div>
          {c.description && <p className="line-clamp-2 text-sm text-fg-secondary">{c.description}</p>}
          <dl className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: "Units", value: c.unitCount },
              { label: "Lessons", value: `${c.publishedLessonCount}/${c.lessonCount}` },
              { label: "Students", value: c.studentCount },
            ].map((s) => (
              <div key={s.label} className="rounded-lg bg-surface-2 px-2 py-2">
                <dt className="text-xs text-fg-muted">{s.label}</dt>
                <dd className="text-sm font-semibold tabular-nums text-fg">{s.value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-auto flex flex-col gap-3">
            <ProgressBar value={c.avgCompletion} size="sm" label="Average completion" showValue />
            <div className="flex items-center gap-2 text-[13px] text-fg-muted">
              {c.teacher ? (
                <>
                  <Avatar name={c.teacher.name} size="xs" />
                  <span className="truncate">{c.teacher.name}</span>
                </>
              ) : (
                <>
                  <Users className="size-4" aria-hidden />
                  <span>No teacher assigned</span>
                </>
              )}
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}
