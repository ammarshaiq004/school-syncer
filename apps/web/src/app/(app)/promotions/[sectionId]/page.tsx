"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ArrowUpRight, CalendarPlus, GraduationCap, Info, LogOut, Repeat, Save, UserX, Users } from "lucide-react";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  buttonClass,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  KpiCard,
  NativeSelect,
  PageHeader,
  Skeleton,
  SkeletonCards,
  SkeletonRows,
  StatGrid,
  StatusPill,
  useToast,
  type Column,
  type Tone,
} from "@/components/ui";
import { api } from "@/lib/api";
import { DECISION_LABEL, type Decision, type SectionPlan } from "@/lib/promotions";
import { useApi } from "@/lib/use-api";

type Row = { decision: Decision; toSectionId: string | null };
type Student = SectionPlan["students"][number];

const DECISION_TONE: Record<Decision, Tone> = { PROMOTE: "success", REPEAT: "warning", LEAVE: "neutral", GRADUATE: "info" };
const DECISIONS = Object.keys(DECISION_LABEL) as Decision[];

/** One class's students: who moves up, stays back, leaves or finishes school. */
export default function PromotionSectionPage() {
  const { sectionId } = useParams<{ sectionId: string }>();
  const plan = useApi<SectionPlan>(`/promotions/sections/${sectionId}`);
  if (plan.data) {
    return <Decisions key={plan.data.students.map((s) => s.decision + s.toSectionId).join()} plan={plan.data} onSaved={plan.reload} />;
  }
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={plan.error ? "Class decisions" : <Skeleton className="h-7 w-40" />}
        breadcrumbs={[{ label: "Promotions", href: "/promotions" }, { label: "Class" }]}
      />
      {plan.errorStatus === 409 ? (
        <Card>
          <EmptyState
            icon={<CalendarPlus />}
            title="Set up next year first"
            description={plan.error}
            action={<Link href="/promotions" className={buttonClass("primary", "sm")}>Go to promotions</Link>}
          />
        </Card>
      ) : plan.error ? (
        <ErrorState message={plan.error} onRetry={plan.reload} />
      ) : (
        <>
          <SkeletonCards count={4} />
          <Card><SkeletonRows rows={8} columns={5} /></Card>
        </>
      )}
    </div>
  );
}

function Decisions({ plan, onSaved }: { plan: SectionPlan; onSaved: () => Promise<void> }) {
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(plan.students.map((s) => [s.id, { decision: s.decision, toSectionId: s.toSectionId }])),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const toast = useToast();
  const up = plan.targets.filter((t) => !t.sameClass);
  const same = plan.targets.filter((t) => t.sameClass);
  const defaultUp = plan.students.find((s) => s.decision === "PROMOTE" && s.toSectionId)?.toSectionId ?? up[0]?.id ?? null;

  function set(id: string, decision: Decision) {
    setRows((r) => ({
      ...r,
      [id]: {
        decision,
        toSectionId: decision === "PROMOTE" ? (r[id].decision === "PROMOTE" ? r[id].toSectionId : defaultUp) : decision === "REPEAT" ? plan.repeatSectionId : null,
      },
    }));
    setDirty(true);
  }

  function keepBackFailed() {
    for (const s of plan.students) if (s.result && !s.result.passed) set(s.id, "REPEAT");
  }

  async function save() {
    setBusy(true);
    try {
      await api(`/promotions/sections/${plan.section.id}`, {
        method: "PUT",
        body: { decisions: plan.students.map((s) => ({ studentId: s.id, ...rows[s.id] })) },
      });
      toast.success("Decisions saved", "Nothing happens to these students until the new year is started.");
      setError("");
      setDirty(false);
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  const failed = plan.students.filter((s) => s.result && !s.result.passed).length;
  const counts = Object.values(rows).reduce<Partial<Record<Decision, number>>>((c, r) => ({ ...c, [r.decision]: (c[r.decision] ?? 0) + 1 }), {});

  const columns: Column<Student>[] = [
    {
      id: "roll",
      header: "Roll",
      align: "right",
      width: "64px",
      sortValue: (s) => s.rollNo,
      cell: (s) => (s.rollNo ?? <span className="text-fg-muted">None</span>),
    },
    {
      id: "student",
      header: "Student",
      sortValue: (s) => s.name,
      cell: (s) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={s.name} size="sm" />
          <div className="min-w-0">
            <Link href={`/students/${s.id}`} className="block truncate font-medium text-fg hover:text-brand">
              {s.name}
            </Link>
            <span className="text-xs text-fg-muted">{s.admissionNo}</span>
          </div>
        </div>
      ),
    },
    {
      id: "result",
      header: "Result",
      sortValue: (s) => s.result?.percent,
      cell: (s) =>
        s.result ? (
          <span className="inline-flex items-center gap-2">
            <span className="tabular-nums text-fg">{Math.round(s.result.percent)}%</span>
            <StatusPill status={s.result.passed ? "passed" : "failed"} label={s.result.passed ? "Passed" : "Failed"} />
          </span>
        ) : (
          <span className="text-fg-muted">No result</span>
        ),
    },
    {
      id: "decision",
      header: "Decision",
      sortValue: (s) => DECISION_LABEL[rows[s.id].decision],
      cell: (s) => (
        <NativeSelect
          value={rows[s.id].decision}
          onChange={(e) => set(s.id, e.target.value as Decision)}
          aria-label={`Decision for ${s.name}`}
          options={DECISIONS.map((d) => ({ value: d, label: DECISION_LABEL[d] }))}
          wrapperClassName="w-40"
          className="h-8"
        />
      ),
    },
    {
      id: "next",
      header: `Class in ${plan.nextYear}`,
      cell: (s) => {
        const r = rows[s.id];
        const options = r.decision === "REPEAT" ? same : r.decision === "PROMOTE" ? up : [];
        return options.length ? (
          <NativeSelect
            value={r.toSectionId ?? ""}
            onChange={(e) => {
              setRows((all) => ({ ...all, [s.id]: { ...r, toSectionId: e.target.value } }));
              setDirty(true);
            }}
            aria-label={`Next year's class for ${s.name}`}
            placeholder={r.toSectionId ? undefined : "Choose"}
            options={options.map((t) => ({ value: t.id, label: t.name }))}
            wrapperClassName="w-44"
            className="h-8"
          />
        ) : r.decision === "PROMOTE" || r.decision === "REPEAT" ? (
          <span className="text-sm text-warning-text">No class set up</span>
        ) : (
          <StatusPill status={r.decision} tone={DECISION_TONE[r.decision]} label={DECISION_LABEL[r.decision]} />
        );
      },
    },
  ];

  const icons: Record<Decision, ReactNode> = {
    PROMOTE: <ArrowUpRight />,
    REPEAT: <Repeat />,
    LEAVE: <LogOut />,
    GRADUATE: <GraduationCap />,
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={plan.section.name}
        breadcrumbs={[{ label: "Promotions", href: "/promotions" }, { label: plan.section.name }]}
        description={`${plan.section.campus}, ${plan.students.length} students, ${plan.exam ? `results from ${plan.exam.name}` : "no published exam this year"}`}
        meta={dirty ? <Badge tone="warning">Unsaved changes</Badge> : undefined}
        actions={
          <>
            {failed > 0 && (
              <Button type="button" variant="secondary" icon={<UserX />} onClick={keepBackFailed}>
                Keep back the {failed} who failed
              </Button>
            )}
            <Button type="button" icon={<Save />} onClick={save} loading={busy}>
              Save decisions
            </Button>
          </>
        }
      />
      {error && <Alert tone="danger" onDismiss={() => setError("")}>{error}</Alert>}
      {plan.topClass && (
        <Alert tone="info" icon={<Info />}>
          This is the school&apos;s last class, so students finish school here. To keep anyone on, choose &ldquo;Stays back&rdquo;.
        </Alert>
      )}

      <StatGrid>
        {DECISIONS.map((d) => (
          <KpiCard key={d} label={DECISION_LABEL[d]} value={counts[d] ?? 0} icon={icons[d]} tone={DECISION_TONE[d]} />
        ))}
      </StatGrid>

      <DataTable
        label={`Students in ${plan.section.name}`}
        columns={columns}
        data={plan.students}
        getRowId={(s) => s.id}
        getSearchText={(s) => `${s.name} ${s.admissionNo}`}
        searchPlaceholder="Search name or admission no."
        defaultSort={{ id: "roll", dir: "asc" }}
        rowClassName={(s) => (s.result && !s.result.passed ? "[&>td]:bg-danger-tint/50" : undefined)}
        empty={{ icon: <Users />, title: "No students in this class", description: "Students enrolled in this section will appear here." }}
        pageSize={0}
      />
    </div>
  );
}
