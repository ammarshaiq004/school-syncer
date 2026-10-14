"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Archive, ClipboardCheck, Inbox, SquareKanban, Phone, Plus, Save, Send, UserCheck, UserPlus } from "lucide-react";
import { EnquiryFields, enquiryBody, type CampusOption } from "@/components/enquiry-fields";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  CountBadge,
  DataTable,
  Drawer,
  EmptyState,
  ErrorState,
  KpiCard,
  NativeSelect,
  PageHeader,
  SearchInput,
  Skeleton,
  StatGrid,
  StatusPill,
  TabPanel,
  Tabs,
  useToast,
  type Column,
  type Tone,
} from "@/components/ui";
import { api } from "@/lib/api";
import { day } from "@/lib/format";
import { saveWarnings, type SaveWarning } from "@/lib/identity";
import { useSectionOptions } from "@/lib/sections";
import { useApi } from "@/lib/use-api";

interface Application {
  id: string;
  childName: string;
  gender: string;
  guardianName: string;
  guardianPhone: string;
  source: string | null;
  stage: string;
  testScore: number | null;
  notes: string | null;
  classId: string;
  studentId: string | null;
  createdAt: string;
  campus: { name: string };
  class: { name: string };
}

const STAGES = ["ENQUIRY", "TEST_SCHEDULED", "TEST_DONE", "INTERVIEW", "OFFERED"];
const ALL_STAGES = [...STAGES, "REJECTED", "WITHDRAWN"];
const STAGE_TONE: Record<string, Tone> = {
  ENQUIRY: "neutral",
  TEST_SCHEDULED: "info",
  TEST_DONE: "primary",
  INTERVIEW: "warning",
  OFFERED: "success",
  ADMITTED: "success",
  REJECTED: "danger",
  WITHDRAWN: "neutral",
};
const label = (s: string) => {
  const t = s.replace(/_/g, " ").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const FORM_ID = "new-enquiry-form";

function StagePill({ stage }: { stage: string }) {
  return <StatusPill status={stage} tone={STAGE_TONE[stage] ?? "neutral"} label={label(stage)} />;
}

export default function AdmissionsPage() {
  const toast = useToast();
  const applications = useApi<Application[]>("/applications");
  const campuses = useApi<{ id: string; name: string }[]>("/campuses");
  const classes = useApi<{ id: string; name: string; campus: { id: string } }[]>("/classes");
  const sections = useSectionOptions();
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState("");
  const [campusId, setCampusId] = useState("");
  const [tab, setTab] = useState("pipeline");
  const [search, setSearch] = useState("");
  const [formError, setFormError] = useState("");
  // An admission the API wants confirmed first (guardian phone saved under another name, likely duplicate).
  const [toConfirm, setToConfirm] = useState<{ id: string; sectionId: string; name: string; warnings: SaveWarning[] } | null>(null);

  const campusOptions: CampusOption[] = (campuses.data ?? []).map((c) => ({
    ...c,
    classes: (classes.data ?? []).filter((k) => k.campus.id === c.id),
  }));
  const selectedCampus = campusId || campusOptions[0]?.id || "";

  async function run(id: string, action: () => Promise<unknown>, done?: string) {
    setBusy(id);
    try {
      await action();
      if (done) toast.success(done);
      await applications.reload();
    } catch (e) {
      toast.error("Could not update the application", (e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function admit(id: string, sectionId: string, name: string, confirmed = false) {
    setBusy(id);
    try {
      await api(`/applications/${id}/admit`, { method: "POST", body: { sectionId, confirmed } });
      setToConfirm(null);
      toast.success(`${name} admitted.`);
      await applications.reload();
    } catch (e) {
      const warnings = saveWarnings(e);
      if (warnings) setToConfirm({ id, sectionId, name, warnings });
      else toast.error("Could not update the application", (e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    setSaving(true);
    try {
      await api("/applications", { method: "POST", body: enquiryBody(new FormData(formEl)) });
      formEl.reset();
      setFormError("");
      setAdding(false);
      toast.success("Enquiry added.");
      await applications.reload();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const q = search.trim().toLowerCase();
  const matches = (a: Application) =>
    !q || `${a.childName} ${a.guardianName} ${a.guardianPhone} ${a.class.name}`.toLowerCase().includes(q);
  const all = applications.data ?? [];
  const open = all.filter((a) => STAGES.includes(a.stage));
  const closed = all.filter((a) => !STAGES.includes(a.stage));
  const shownOpen = open.filter(matches);
  const loading = !applications.data && !applications.error;
  const count = (pred: (a: Application) => boolean) => (loading ? "" : all.filter(pred).length.toLocaleString("en-PK"));

  const closedColumns: Column<Application>[] = [
    {
      id: "child",
      header: "Child",
      sortValue: (a) => a.childName,
      cell: (a) => (
        <div className="flex items-center gap-3">
          <Avatar name={a.childName} size="sm" />
          {a.studentId ? (
            <Link href={`/students/${a.studentId}`} className="font-medium text-fg hover:text-brand">
              {a.childName}
            </Link>
          ) : (
            <span className="font-medium text-fg">{a.childName}</span>
          )}
        </div>
      ),
    },
    { id: "class", header: "Class", sortValue: (a) => a.class.name, cell: (a) => a.class.name },
    { id: "campus", header: "Campus", cell: (a) => a.campus.name, hideBelow: "md" },
    { id: "guardian", header: "Guardian", cell: (a) => `${a.guardianName}, ${a.guardianPhone}`, hideBelow: "lg" },
    { id: "date", header: "Received", sortValue: (a) => a.createdAt, cell: (a) => day(a.createdAt), hideBelow: "sm" },
    {
      id: "stage",
      header: "Outcome",
      sortValue: (a) => (a.studentId ? "ADMITTED" : a.stage),
      cell: (a) => <StagePill stage={a.studentId ? "ADMITTED" : a.stage} />,
    },
  ];

  const newButton = (
    <Button icon={<Plus />} onClick={() => setAdding(true)}>
      New enquiry
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Admissions"
        description="Track every enquiry from first call to admission."
        breadcrumbs={[{ label: "People" }, { label: "Admissions" }]}
        actions={newButton}
      />

      <StatGrid>
        <KpiCard label="Open enquiries" value={count((a) => STAGES.includes(a.stage))} icon={<Inbox />} loading={loading} />
        <KpiCard
          label="In testing or interview"
          value={count((a) => ["TEST_SCHEDULED", "TEST_DONE", "INTERVIEW"].includes(a.stage))}
          icon={<ClipboardCheck />}
          tone="info"
          loading={loading}
        />
        <KpiCard label="Offered a seat" value={count((a) => a.stage === "OFFERED")} icon={<Send />} tone="warning" loading={loading} />
        <KpiCard label="Admitted" value={count((a) => !!a.studentId)} icon={<UserCheck />} tone="success" loading={loading} />
      </StatGrid>

      <Tabs
        value={tab}
        onValueChange={setTab}
        aria-label="Admissions views"
        tabs={[
          { value: "pipeline", label: "Pipeline", icon: <SquareKanban />, count: applications.data ? open.length : undefined },
          { value: "closed", label: "Admitted, rejected and withdrawn", icon: <Archive />, count: applications.data ? closed.length : undefined },
        ]}
      >
        <TabPanel value="pipeline">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <SearchInput
              placeholder="Search child, guardian or phone"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onClear={() => setSearch("")}
              wrapperClassName="w-full sm:w-80"
            />
          </div>
          {applications.error ? (
            <ErrorState message={applications.error} onRetry={applications.reload} />
          ) : loading ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              {STAGES.map((s) => (
                <div key={s} className="flex flex-col gap-3 rounded-xl bg-surface-2 p-3">
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="h-28 w-full rounded-lg" />
                  <Skeleton className="h-28 w-full rounded-lg" />
                </div>
              ))}
            </div>
          ) : open.length === 0 ? (
            <EmptyState
              icon={<UserPlus />}
              title="No open enquiries"
              description="Add enquiries from phone calls and walk-ins, or share your public admission form with parents."
              action={newButton}
            />
          ) : (
            <div className="-mx-4 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
              <div className="grid auto-cols-[minmax(260px,1fr)] grid-flow-col gap-4 xl:auto-cols-auto xl:grid-flow-row xl:grid-cols-5">
                {STAGES.map((stage) => {
                  const items = shownOpen.filter((a) => a.stage === stage);
                  return (
                    <section key={stage} aria-label={label(stage)} className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface-2 p-3">
                      <header className="flex items-center justify-between gap-2 px-1">
                        <StagePill stage={stage} />
                        <CountBadge count={items.length} />
                      </header>
                      {items.length === 0 && (
                        <p className="rounded-lg border border-dashed border-border-strong px-3 py-6 text-center text-xs text-fg-muted">
                          {q ? "No matches" : "Nobody at this stage"}
                        </p>
                      )}
                      {items.map((a) => {
                        const sectionOpts = sections.options.filter((o) => o.classId === a.classId);
                        return (
                          <article key={a.id} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 shadow-card">
                            <div className="flex items-start gap-2.5">
                              <Avatar name={a.childName} size="sm" />
                              <div className="min-w-0 flex-1">
                                <h3 className="truncate text-sm font-semibold text-fg">{a.childName}</h3>
                                <p className="truncate text-xs text-fg-muted">
                                  {a.class.name} · {a.campus.name}
                                </p>
                              </div>
                              {a.testScore !== null && <Badge tone="primary">Test {a.testScore}</Badge>}
                            </div>
                            <div className="flex flex-col gap-1 text-xs text-fg-secondary">
                              <span className="truncate">{a.guardianName}</span>
                              <a href={`tel:${a.guardianPhone}`} className="inline-flex w-fit items-center gap-1.5 tabular-nums hover:text-brand">
                                <Phone className="size-3 text-fg-muted" aria-hidden />
                                {a.guardianPhone}
                              </a>
                              <span className="text-fg-muted">
                                {a.source ?? "Walk-in"} · {day(a.createdAt)}
                              </span>
                            </div>
                            <div className="flex flex-col gap-2 border-t border-border pt-3">
                              <NativeSelect
                                aria-label={`Stage for ${a.childName}`}
                                value={a.stage}
                                disabled={busy === a.id}
                                onChange={(e) => {
                                  const stageValue = e.target.value;
                                  void run(a.id, () => api(`/applications/${a.id}`, { method: "PATCH", body: { stage: stageValue } }));
                                }}
                                options={ALL_STAGES.map((s) => ({ value: s, label: label(s) }))}
                                className="h-8 text-xs"
                              />
                              <form
                                className="flex gap-2"
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  const sectionId = String(new FormData(e.currentTarget).get("sectionId") ?? "");
                                  void admit(a.id, sectionId, a.childName);
                                }}
                              >
                                <NativeSelect
                                  name="sectionId"
                                  required
                                  aria-label={`Section to admit ${a.childName} into`}
                                  options={sectionOpts}
                                  placeholder={sectionOpts.length ? undefined : "No sections"}
                                  wrapperClassName="min-w-0 flex-1"
                                  className="h-8 text-xs"
                                />
                                <Button type="submit" size="sm" icon={<UserCheck />} loading={busy === a.id} disabled={!sectionOpts.length}>
                                  Admit
                                </Button>
                              </form>
                            </div>
                          </article>
                        );
                      })}
                    </section>
                  );
                })}
              </div>
            </div>
          )}
        </TabPanel>

        <TabPanel value="closed">
          <DataTable
            label="Closed applications"
            columns={closedColumns}
            data={applications.data ? closed : null}
            getRowId={(a) => a.id}
            error={applications.error}
            onRetry={applications.reload}
            getSearchText={(a) => `${a.childName} ${a.guardianName} ${a.guardianPhone} ${a.class.name}`}
            searchPlaceholder="Search child, guardian or phone"
            defaultSort={{ id: "date", dir: "desc" }}
            empty={{ title: "Nothing closed yet", description: "Admitted, rejected and withdrawn applications show up here." }}
          />
        </TabPanel>
      </Tabs>

      <Drawer
        open={adding}
        onOpenChange={(o) => {
          setAdding(o);
          if (!o) setFormError("");
        }}
        title="New enquiry"
        description="Record a phone call or walk-in. It starts in the Enquiry stage."
        size="lg"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button type="submit" form={FORM_ID} loading={saving} icon={<Save />}>
              Save enquiry
            </Button>
          </>
        }
      >
        {campuses.error || classes.error ? (
          <ErrorState message={campuses.error || classes.error} onRetry={() => void Promise.all([campuses.reload(), classes.reload()])} compact />
        ) : (
          <form id={FORM_ID} onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
            <EnquiryFields campuses={campusOptions} campusId={selectedCampus} onCampusChange={setCampusId} />
            {formError && (
              <Alert tone="danger" className="col-span-full">
                {formError}
              </Alert>
            )}
          </form>
        )}
      </Drawer>

      <ConfirmDialog
        open={toConfirm !== null}
        onOpenChange={(o) => !o && setToConfirm(null)}
        title={`Admit ${toConfirm?.name ?? ""} anyway?`}
        description={toConfirm?.warnings.map((w) => w.message).join(" ")}
        confirmLabel="Admit anyway"
        loading={busy === toConfirm?.id}
        onConfirm={() => toConfirm && void admit(toConfirm.id, toConfirm.sectionId, toConfirm.name, true)}
      />
    </div>
  );
}
