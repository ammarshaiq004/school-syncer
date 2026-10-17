"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Bug, ExternalLink, StickyNote } from "lucide-react";
import {
  Badge,
  Button,
  DataTable,
  DescriptionList,
  Drawer,
  ErrorState,
  NativeSelect,
  PageHeader,
  SearchInput,
  SegmentedControl,
  SkeletonRows,
  StatusPill,
  TextareaField,
  useToast,
  type Column,
} from "@/components/ui";
import { when } from "@/components/platform/session";
import { roleLabel } from "@/components/shell/topbar";
import { platformApi } from "@/lib/api";
import { describeBrowser, PROBLEM_STATUS_LABEL, PROBLEM_STATUS_TONE, PROBLEM_STATUSES, type ProblemReport, type ProblemStatus } from "@/lib/problem-reports";
import { usePlatformApi } from "@/lib/use-api";

interface InboxReport extends ProblemReport {
  schoolId: string;
  updatedAt: string;
  school: { id: string; name: string; slug: string };
  activity: { id: string; at: string; adminName: string; status: ProblemStatus | null; fromStatus: ProblemStatus | null; note: string | null }[];
}

interface InboxPage {
  items: InboxReport[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<ProblemStatus, number>;
}

interface Detail extends InboxReport {
  reporter: { id: string; name: string; email: string | null; phone: string | null; username: string | null; isActive: boolean } | null;
  screenshot: { url: string; filename: string } | null;
}

type Filter = "open" | "all" | ProblemStatus;

const columns: Column<InboxReport>[] = [
  {
    id: "message",
    header: "Problem",
    cell: (r) => (
      <span className="block min-w-0 max-w-xl">
        <span className="line-clamp-2 text-fg">{r.message}</span>
        <span className="block truncate font-mono text-xs text-fg-muted">{r.page}</span>
      </span>
    ),
  },
  {
    id: "school",
    header: "School",
    cell: (r) => (
      <span className="block min-w-0">
        <span className="block truncate font-medium text-fg">{r.school.name}</span>
        <span className="block truncate text-xs text-fg-muted">
          {r.reporterName}, {roleLabel(r.roles.map((role) => ({ role })))}
        </span>
      </span>
    ),
    hideBelow: "md",
  },
  { id: "when", header: "Sent", cell: (r) => <time dateTime={r.createdAt} className="whitespace-nowrap text-fg-secondary">{when(r.createdAt)}</time>, hideBelow: "lg" },
  { id: "status", header: "Status", cell: (r) => <StatusPill status={r.status} tone={PROBLEM_STATUS_TONE[r.status]} label={PROBLEM_STATUS_LABEL[r.status]} /> },
];

/**
 * Problem reports from schools (SCHOOL-150): triage them, move them through
 * new, in progress, fixed and won't fix (the reporter sees each change), and
 * keep internal notes the school never sees.
 */
export default function ProblemReportsInbox() {
  // A school's pilot health page links here with ?schoolId=...
  const [schoolId, setSchoolId] = useState(() => new URLSearchParams(window.location.search).get("schoolId") ?? "");
  const [filter, setFilter] = useState<Filter>("open");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const query = new URLSearchParams({
    page: String(page),
    ...(schoolId && { schoolId }),
    ...(filter === "open" ? { open: "true" } : filter !== "all" ? { status: filter } : {}),
    ...(q.trim() && { q: q.trim() }),
  });
  const inbox = usePlatformApi<InboxPage>(`/problem-reports?${query}`);
  const schools = usePlatformApi<{ id: string; name: string }[]>("/schools");
  const counts = inbox.data?.counts;
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Problem reports" description="What schools sent with Report a problem, newest first. Status changes are shown to the reporter; notes are not." />
      <DataTable
        label="Problem reports"
        columns={columns}
        data={inbox.data?.items}
        getRowId={(r) => r.id}
        error={inbox.error}
        onRetry={inbox.reload}
        filters={
          <>
            <SearchInput
              aria-label="Search reports"
              placeholder="Search message, page or name"
              value={q}
              onChange={(e) => reset(setQ)(e.target.value)}
              onClear={() => reset(setQ)("")}
              wrapperClassName="w-64"
            />
            <SegmentedControl<Filter>
              aria-label="Status"
              value={filter}
              onChange={reset(setFilter)}
              options={[
                { value: "open", label: `Open${counts ? ` (${counts.NEW + counts.IN_PROGRESS})` : ""}` },
                ...PROBLEM_STATUSES.map((s) => ({ value: s, label: `${PROBLEM_STATUS_LABEL[s]}${counts ? ` (${counts[s]})` : ""}` })),
                { value: "all" as const, label: "All" },
              ]}
            />
            <NativeSelect
              aria-label="School"
              placeholder="Every school"
              options={(schools.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
              value={schoolId}
              onChange={(e) => reset(setSchoolId)(e.target.value)}
              wrapperClassName="w-52"
            />
          </>
        }
        manualFiltering
        filtered={!!(schoolId || q || filter !== "all")}
        serverPagination={inbox.data ? { page: inbox.data.page, pageSize: inbox.data.pageSize, total: inbox.data.total, onPageChange: setPage } : undefined}
        empty={{ icon: <Bug />, title: "No reports here", description: "Reports matching these filters show here." }}
        onRowClick={(r) => setOpenId(r.id)}
        getRowLabel={(r) => `Open the report from ${r.school.name}`}
      />
      <ReportDrawer id={openId} onClose={() => setOpenId(null)} onChanged={inbox.reload} />
    </div>
  );
}

function ReportDrawer({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const detail = usePlatformApi<Detail>(id ? `/problem-reports/${id}` : null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const r = detail.data?.id === id ? detail.data : null;

  async function change(path: string, method: string, body: object, what: string) {
    setBusy(what);
    try {
      await platformApi(path, { method, body });
      await Promise.all([detail.reload(), onChanged()]);
      return true;
    } catch (e) {
      toast.error("Could not save", (e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function addNote(event: FormEvent) {
    event.preventDefault();
    if (await change(`/problem-reports/${id}/notes`, "POST", { note }, "note")) setNote("");
  }

  return (
    <Drawer
      open={!!id}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={r ? `Report from ${r.school.name}` : "Problem report"}
      description={r ? when(r.createdAt) : undefined}
      headerExtra={
        r && (
          <SegmentedControl<ProblemStatus>
            aria-label="Status"
            value={r.status}
            onChange={(s) => void change(`/problem-reports/${r.id}`, "PATCH", { status: s }, "status")}
            options={PROBLEM_STATUSES.map((s) => ({ value: s, label: PROBLEM_STATUS_LABEL[s] }))}
          />
        )
      }
    >
      {detail.error ? (
        <ErrorState compact message={detail.error} onRetry={detail.reload} />
      ) : !r ? (
        <SkeletonRows rows={5} columns={1} />
      ) : (
        <div className="flex flex-col gap-5">
          <p className="whitespace-pre-line break-words text-sm text-fg">{r.message}</p>
          {r.screenshot && (
            <a href={r.screenshot.url} target="_blank" rel="noopener noreferrer" className="block">
              {/* A signed link to the school's upload. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.screenshot.url} alt="Screenshot sent with the report" className="max-h-80 rounded-lg border border-border" />
            </a>
          )}
          <DescriptionList
            columns={2}
            items={[
              {
                label: "School",
                value: (
                  <Link href={`/platform/schools/${r.school.id}`} className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
                    {r.school.name}
                    <ExternalLink className="size-3.5" aria-hidden />
                  </Link>
                ),
              },
              { label: "Reported by", value: `${r.reporterName}${r.reporter && !r.reporter.isActive ? " (deactivated)" : ""}` },
              { label: "Role", value: roleLabel(r.roles.map((role) => ({ role }))) || "None" },
              { label: "Contact", value: r.reporter ? [r.reporter.phone, r.reporter.email, r.reporter.username].filter(Boolean).join(", ") || "None" : "Account removed" },
              { label: "Page or screen", value: <span className="break-all font-mono text-[13px]">{r.page}</span> },
              { label: "From", value: r.source === "MOBILE" ? <Badge tone="neutral">Mobile app</Badge> : "Web" },
              { label: "App version", value: r.appVersion ?? "Not sent" },
              { label: "Browser or phone", value: <span title={r.browser ?? undefined}>{describeBrowser(r.browser)}</span> },
            ]}
          />
          <section aria-label="Activity" className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-fg">Activity</h3>
            {r.activity.length === 0 ? (
              <p className="text-sm text-fg-muted">Nothing yet.</p>
            ) : (
              <ol className="flex flex-col gap-2.5">
                {r.activity.map((a) => (
                  <li key={a.id} className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
                    <p className="text-xs text-fg-muted">
                      {a.adminName} · {when(a.at)}
                    </p>
                    {a.note ? (
                      <p className="mt-1 flex gap-2 whitespace-pre-line text-fg">
                        <StickyNote className="mt-0.5 size-3.5 shrink-0 text-warning" aria-label="Internal note" />
                        {a.note}
                      </p>
                    ) : (
                      <p className="mt-1 text-fg">
                        {a.fromStatus ? `${PROBLEM_STATUS_LABEL[a.fromStatus]} to ` : "Set to "}
                        <strong>{a.status ? PROBLEM_STATUS_LABEL[a.status] : ""}</strong>
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
            <form onSubmit={addNote} className="flex flex-col gap-2">
              <TextareaField label="Internal note" hint="Only SchoolSyncer staff see notes." rows={3} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex justify-end">
                <Button type="submit" variant="secondary" size="sm" loading={busy === "note"} disabled={!note.trim() || !!busy}>
                  Add note
                </Button>
              </div>
            </form>
          </section>
        </div>
      )}
    </Drawer>
  );
}
