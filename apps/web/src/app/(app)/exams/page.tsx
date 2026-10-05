"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { CalendarRange, CircleCheck, FilePenLine, FileText, Plus, Save, Scale, Trash2 } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  DataTable,
  Drawer,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  KpiCard,
  LetterGrade,
  PageHeader,
  SelectField,
  SkeletonRows,
  StatGrid,
  StatusPill,
  TextField,
  useToast,
  type Column,
} from "@/components/ui";
import { api } from "@/lib/api";
import { day } from "@/lib/format";
import { can, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

interface Exam {
  id: string;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  status: "DRAFT" | "PUBLISHED";
  academicYear: { name: string };
  _count: { papers: number; results: number };
}
interface AcademicYear { id: string; name: string; isCurrent: boolean }
interface Band { grade: string; minPercent: number; remark: string | null }

const NEW_EXAM_FORM = "new-exam-form";

function dateRange(e: Exam) {
  if (!e.startsOn) return <span className="text-fg-muted">Not set</span>;
  return `${day(e.startsOn)}${e.endsOn ? ` to ${day(e.endsOn)}` : ""}`;
}

export default function ExamsPage() {
  const user = useSession();
  // Whoever has "manage" on exams runs them: administrators, and custom roles
  // such as an exam coordinator.
  const canManage = can(user, "exams", "manage");
  const exams = useApi<Exam[]>("/exams");
  const years = useApi<AcademicYear[]>(canManage ? "/academic-years" : null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const f = new FormData(form);
    setSaving(true);
    try {
      await api("/exams", {
        method: "POST",
        body: {
          name: f.get("name"),
          academicYearId: f.get("academicYearId"),
          startsOn: f.get("startsOn") || undefined,
          endsOn: f.get("endsOn") || undefined,
        },
      });
      form.reset();
      setError("");
      setCreating(false);
      toast.success("Exam created", `${String(f.get("name"))} is ready for papers.`);
      await exams.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const sortedYears = [...(years.data ?? [])].sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
  const list = exams.data;
  const published = list?.filter((e) => e.status === "PUBLISHED").length ?? 0;
  const papers = list?.reduce((n, e) => n + e._count.papers, 0) ?? 0;
  const loading = !list && !exams.error;

  const columns: Column<Exam>[] = [
    {
      id: "name",
      header: "Exam",
      sortValue: (e) => e.name,
      cell: (e) => (
        <Link href={`/exams/${e.id}`} className="font-medium text-fg hover:text-brand">
          {e.name}
        </Link>
      ),
    },
    { id: "year", header: "Year", sortValue: (e) => e.academicYear.name, cell: (e) => e.academicYear.name, hideBelow: "sm" },
    { id: "dates", header: "Dates", sortValue: (e) => e.startsOn, cell: dateRange, hideBelow: "md" },
    { id: "papers", header: "Papers", align: "right", sortValue: (e) => e._count.papers, cell: (e) => e._count.papers },
    { id: "status", header: "Status", sortValue: (e) => e.status, cell: (e) => <StatusPill status={e.status} /> },
  ];

  const newExamButton = canManage ? (
    <Button icon={<Plus />} onClick={() => setCreating(true)}>
      New exam
    </Button>
  ) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Exams and results"
        description="Set up papers, enter marks and publish report cards to parents."
        breadcrumbs={[{ label: "Academics" }, { label: "Exams" }]}
        actions={newExamButton}
      />

      <StatGrid>
        <KpiCard label="Exams" value={list?.length ?? 0} icon={<FileText />} loading={loading} />
        <KpiCard label="Published" value={published} icon={<CircleCheck />} tone="success" loading={loading} />
        <KpiCard label="Drafts" value={(list?.length ?? 0) - published} icon={<FilePenLine />} tone="warning" loading={loading} />
        <KpiCard label="Papers set" value={papers} icon={<CalendarRange />} tone="info" loading={loading} />
      </StatGrid>

      <DataTable
        label="Exams"
        columns={columns}
        data={list}
        getRowId={(e) => e.id}
        error={exams.error}
        onRetry={exams.reload}
        getSearchText={(e) => `${e.name} ${e.academicYear.name}`}
        searchPlaceholder="Search exams"
        defaultSort={{ id: "dates", dir: "desc" }}
        empty={{
          icon: <FileText />,
          title: "No exams yet",
          description: canManage ? "Create an exam, add its papers, then teachers can enter marks." : "Exams appear here once the school sets them up.",
          action: newExamButton,
        }}
        getRowLabel={(e) => e.name}
      />

      {canManage && <GradeScale />}

      {canManage && (
        <Drawer
          open={creating}
          onOpenChange={setCreating}
          title="New exam"
          description="Papers and dates per class are added on the exam page."
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button type="submit" form={NEW_EXAM_FORM} loading={saving}>
                Create exam
              </Button>
            </>
          }
        >
          <form id={NEW_EXAM_FORM} className="grid gap-4" onSubmit={create}>
            <TextField label="Name" name="name" placeholder="Mid-term 2026" required />
            {years.error ? (
              <ErrorState message={years.error} onRetry={years.reload} compact />
            ) : (
              <SelectField
                label="Academic year"
                name="academicYearId"
                required
                disabled={!years.data}
                options={sortedYears.map((y) => ({ value: y.id, label: y.isCurrent ? `${y.name} (current)` : y.name }))}
              />
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Starts" name="startsOn" type="date" />
              <TextField label="Ends" name="endsOn" type="date" />
            </div>
            {error && <Alert tone="danger">{error}</Alert>}
          </form>
        </Drawer>
      )}
    </div>
  );
}

/** The school's grading scale, edited as a small table. */
function GradeScale() {
  const bands = useApi<Band[]>("/exams/grade-bands");
  const [draft, setDraft] = useState<Band[] | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const rows = draft ?? bands.data ?? [];

  const update = (i: number, patch: Partial<Band>) =>
    setDraft(rows.map((b, k) => (k === i ? { ...b, ...patch } : b)));

  async function save() {
    setSaving(true);
    try {
      await api("/exams/grade-bands", {
        method: "PUT",
        body: { bands: rows.map((b) => ({ grade: b.grade, minPercent: Number(b.minPercent), remark: b.remark || undefined })) },
      });
      setDraft(null);
      setError("");
      toast.success("Grading scale saved", "It applies the next time results are published.");
      await bands.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const addBand = () => setDraft([...rows, { grade: "", minPercent: 0, remark: "" }]);
  const cellInput = "h-8 px-2";

  return (
    <Card>
      <CardHeader
        icon={<Scale />}
        title="Grading scale"
        description="A student gets the highest grade whose minimum percentage they reach."
        action={
          <div className="flex flex-wrap gap-2">
            {draft && (
              <Button type="button" variant="ghost" size="sm" onClick={() => { setDraft(null); setError(""); }}>
                Discard
              </Button>
            )}
            <Button type="button" size="sm" icon={<Save />} onClick={save} disabled={!draft} loading={saving}>
              Save scale
            </Button>
          </div>
        }
      />
      <div className="mt-4">
        {bands.error && !draft ? (
          <ErrorState message={bands.error} onRetry={bands.reload} compact />
        ) : !bands.data && !draft ? (
          <SkeletonRows rows={4} columns={3} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Scale />}
            title="No grades yet"
            description="Add grades such as A+ from 90% so results show a letter grade."
            action={<Button type="button" variant="secondary" size="sm" icon={<Plus />} onClick={addBand}>Add grade</Button>}
            compact
          />
        ) : (
          <div className="max-w-2xl overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left text-xs font-medium uppercase tracking-[0.04em] text-fg-muted [&>th]:h-10 [&>th]:border-b [&>th]:border-border [&>th]:bg-surface-2 [&>th]:px-3">
                  <th scope="col" className="w-24">Grade</th>
                  <th scope="col" className="w-28">From %</th>
                  <th scope="col">Remark</th>
                  <th scope="col" className="w-12"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b, i) => (
                  <tr key={i} className="even:bg-surface-2/60 [&>td]:border-b [&>td]:border-border [&>td]:px-3 [&>td]:py-1.5 last:[&>td]:border-b-0">
                    <td>
                      <div className="flex items-center gap-2">
                        <Input className={`${cellInput} w-14`} value={b.grade} onChange={(e) => update(i, { grade: e.target.value })} aria-label={`Grade ${i + 1} letter`} />
                        {b.grade && <LetterGrade grade={b.grade} className="hidden sm:inline-flex" />}
                      </div>
                    </td>
                    <td>
                      <Input
                        className={`${cellInput} text-right tabular-nums`}
                        type="number"
                        min={0}
                        max={100}
                        value={b.minPercent}
                        onChange={(e) => update(i, { minPercent: Number(e.target.value) })}
                        aria-label={`Minimum percent for grade ${b.grade || i + 1}`}
                      />
                    </td>
                    <td>
                      <Input className={cellInput} value={b.remark ?? ""} placeholder="Excellent" onChange={(e) => update(i, { remark: e.target.value })} aria-label={`Remark for grade ${b.grade || i + 1}`} />
                    </td>
                    <td className="text-right">
                      <IconButton size="sm" aria-label={`Remove grade ${b.grade || i + 1}`} onClick={() => setDraft(rows.filter((_, k) => k !== i))}>
                        <Trash2 />
                      </IconButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 0 && (
          <Button type="button" variant="ghost" size="sm" icon={<Plus />} className="mt-3" onClick={addBand}>
            Add grade
          </Button>
        )}
        {error && <Alert tone="danger" className="mt-3">{error}</Alert>}
      </div>
    </Card>
  );
}
