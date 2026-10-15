"use client";

import Link from "next/link";
import { useState } from "react";
import { Activity, BellRing, CircleCheck, Inbox, MessageSquareWarning, RefreshCw, RotateCcw, ServerCrash, Skull } from "lucide-react";
import {
  Alert,
  BarChart,
  Button,
  Card,
  CardHeader,
  DataTable,
  ErrorState,
  KpiCard,
  PageHeader,
  Skeleton,
  StatGrid,
  StatusPill,
  useToast,
  type Column,
} from "@/components/ui";
import { platformApi } from "@/lib/api";
import { plural } from "@/lib/format";
import { usePlatformApi } from "@/lib/use-api";

interface Check {
  ok: boolean;
  detail: string;
}

interface QueueStats {
  queue: string;
  due: number;
  scheduled: number;
  running: number;
  retrying: number;
  dead: number;
  dead24h: number;
  done24h: number;
  oldestDueAt: string | null;
}

interface ProblemJob {
  id: string;
  queue: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  runAt: string;
  createdAt: string;
  finishedAt: string | null;
  retryable?: boolean;
}

interface SchoolMessages {
  schoolId: string;
  schoolName: string;
  slug: string | null;
  total: number;
  sent: number;
  failed: number;
  queued: number;
  lastError: string | null;
}

interface Gateway {
  provider: string;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastDate: string | null;
  lastTrigger: string | null;
  openIssues: number;
}

interface SystemAlert {
  key: string;
  severity: "warning" | "critical";
  summary: string;
  detail: string;
  openedAt: string;
  lastNotifiedAt: string | null;
  notifications: number;
}

interface SystemHealth {
  generatedAt: string;
  readiness: {
    status: "ok" | "error";
    checks: {
      database: Check;
      jobs?: Check & { due: number; lagSeconds: number };
      reconciliation?: Check & { enabled: boolean; lastSuccessAt: string | null; lastFailureAt: string | null };
    };
  };
  queues: QueueStats[];
  deadJobs: ProblemJob[];
  retryingJobs: ProblemJob[];
  messages: { since: string; total: number; sent: number; failed: number; bySchool: SchoolMessages[] };
  apiErrors: { total: number; hours: { hour: string; count: number }[] };
  reconciliation: { failedRuns24h: number; gateways: Gateway[] };
  alerts: SystemAlert[];
}

const num = (n: number) => n.toLocaleString("en-PK");
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Never";
const percent = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "0%");
const GATEWAY_LABEL: Record<string, string> = { JAZZCASH: "JazzCash", EASYPAISA: "Easypaisa", ONEBILL: "1Bill (1LINK)" };

function minutes(seconds: number) {
  if (seconds < 120) return `${seconds} s`;
  const m = Math.round(seconds / 60);
  return m < 120 ? `${m} min` : `${Math.round(m / 60)} h`;
}

const queueColumns: Column<QueueStats>[] = [
  { id: "queue", header: "Queue", sortValue: (q) => q.queue, cell: (q) => <span className="font-mono text-[13px] text-fg">{q.queue}</span> },
  { id: "due", header: "Due", align: "right", sortValue: (q) => q.due, cell: (q) => num(q.due) },
  { id: "running", header: "Running", align: "right", sortValue: (q) => q.running, cell: (q) => num(q.running), hideBelow: "sm" },
  { id: "retrying", header: "Retrying", align: "right", sortValue: (q) => q.retrying, cell: (q) => num(q.retrying) },
  { id: "dead", header: "Failed", align: "right", sortValue: (q) => q.dead, cell: (q) => (q.dead ? <span className="font-medium text-danger">{num(q.dead)}</span> : "0") },
  { id: "dead24h", header: "Failed (24h)", align: "right", sortValue: (q) => q.dead24h, cell: (q) => num(q.dead24h), hideBelow: "md" },
  { id: "done24h", header: "Done (24h)", align: "right", sortValue: (q) => q.done24h, cell: (q) => num(q.done24h), hideBelow: "md" },
  { id: "scheduled", header: "Later", align: "right", sortValue: (q) => q.scheduled, cell: (q) => num(q.scheduled), hideBelow: "lg" },
  { id: "oldest", header: "Oldest due", sortValue: (q) => q.oldestDueAt, cell: (q) => (q.oldestDueAt ? when(q.oldestDueAt) : "None"), hideBelow: "lg" },
];

const messageColumns: Column<SchoolMessages>[] = [
  {
    id: "school",
    header: "School",
    sortValue: (s) => s.schoolName,
    cell: (s) => (
      <Link href={`/platform/schools/${s.schoolId}`} className="font-medium text-fg hover:text-brand">
        {s.schoolName}
      </Link>
    ),
  },
  { id: "failed", header: "Failed", align: "right", sortValue: (s) => s.failed, cell: (s) => <span className="font-medium text-danger">{num(s.failed)}</span> },
  { id: "rate", header: "Failure rate", align: "right", sortValue: (s) => s.failed / Math.max(1, s.total), cell: (s) => percent(s.failed, s.total) },
  { id: "total", header: "Messages", align: "right", sortValue: (s) => s.total, cell: (s) => num(s.total), hideBelow: "sm" },
  { id: "error", header: "Latest error", cell: (s) => <span className="line-clamp-2 text-xs text-fg-muted">{s.lastError ?? ""}</span>, hideBelow: "md" },
];

const gatewayColumns: Column<Gateway>[] = [
  { id: "provider", header: "Gateway", cell: (g) => <span className="font-medium text-fg">{GATEWAY_LABEL[g.provider] ?? g.provider}</span> },
  { id: "last", header: "Last reconciled", sortValue: (g) => g.lastRunAt, cell: (g) => when(g.lastRunAt) },
  {
    id: "status",
    header: "Result",
    cell: (g) =>
      g.lastStatus ? (
        <StatusPill status={g.lastStatus} tone={g.lastStatus === "CLEAN" ? "success" : g.lastStatus === "ISSUES" ? "warning" : "danger"} />
      ) : (
        <span className="text-fg-muted">Not yet</span>
      ),
  },
  { id: "date", header: "Day covered", cell: (g) => g.lastDate ?? "", hideBelow: "sm" },
  { id: "trigger", header: "Run by", cell: (g) => (g.lastTrigger === "auto" ? "Nightly" : g.lastTrigger ? "A school" : ""), hideBelow: "md" },
  { id: "issues", header: "Open issues", align: "right", sortValue: (g) => g.openIssues, cell: (g) => num(g.openIssues) },
];

function CheckRow({ label, check }: { label: string; check?: Check }) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <StatusPill status={check?.ok ? "OK" : "FAILING"} tone={!check ? "neutral" : check.ok ? "success" : "danger"} label={!check ? "Not checked" : check.ok ? "OK" : "Failing"} />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-fg">{label}</span>
        <span className="block text-[13px] text-fg-muted">{check?.detail ?? "Skipped while the database is down"}</span>
      </span>
    </li>
  );
}

/** SchoolSyncer's own health: readiness, background jobs, message delivery, server errors and reconciliation. */
export default function SystemHealthPage() {
  const toast = useToast();
  const { data, error, reload } = usePlatformApi<SystemHealth>("/system-health");
  const [retrying, setRetrying] = useState<string | null>(null);
  const loading = !data && !error;

  async function retry(job: ProblemJob) {
    setRetrying(job.id);
    try {
      await platformApi(`/system-health/jobs/${job.id}/retry`, { method: "POST" });
      toast.success("Job queued again", `It runs on the next pass of the ${job.queue} worker.`);
      await reload();
    } catch (e) {
      toast.error("Could not retry the job", (e as Error).message);
    } finally {
      setRetrying(null);
    }
  }

  const deadColumns: Column<ProblemJob>[] = [
    { id: "queue", header: "Queue", sortValue: (j) => j.queue, cell: (j) => <span className="font-mono text-[13px] text-fg">{j.queue}</span> },
    { id: "failed", header: "Failed", sortValue: (j) => j.finishedAt, cell: (j) => when(j.finishedAt) },
    { id: "attempts", header: "Attempts", align: "right", cell: (j) => `${j.attempts}/${j.maxAttempts}`, hideBelow: "sm" },
    { id: "error", header: "Error", cell: (j) => <span className="line-clamp-2 text-xs text-fg-muted">{j.lastError ?? ""}</span>, hideBelow: "md" },
    {
      id: "retry",
      header: <span className="sr-only">Retry</span>,
      align: "right",
      cell: (j) =>
        j.retryable ? (
          <Button type="button" size="sm" variant="secondary" icon={<RotateCcw />} loading={retrying === j.id} onClick={() => retry(j)}>
            Retry
          </Button>
        ) : (
          <span className="text-xs text-fg-muted" title="Message deliveries drop their contents once finished: send it again from the school.">
            Cannot retry
          </span>
        ),
    },
  ];

  const retryingColumns: Column<ProblemJob>[] = [
    { id: "queue", header: "Queue", sortValue: (j) => j.queue, cell: (j) => <span className="font-mono text-[13px] text-fg">{j.queue}</span> },
    { id: "next", header: "Next attempt", sortValue: (j) => j.runAt, cell: (j) => when(j.runAt) },
    { id: "attempts", header: "Attempts", align: "right", cell: (j) => `${j.attempts}/${j.maxAttempts}` },
    { id: "error", header: "Last error", cell: (j) => <span className="line-clamp-2 text-xs text-fg-muted">{j.lastError ?? ""}</span>, hideBelow: "md" },
  ];

  const checks = data?.readiness.checks;
  const failing = data ? [checks?.database, checks?.jobs, checks?.reconciliation].filter((c) => c && !c.ok) : [];
  const deadCount = data?.queues.reduce((n, q) => n + q.dead, 0) ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="System health"
        description={data ? `Background jobs, message delivery, server errors and reconciliation. Updated ${when(data.generatedAt)}.` : "Background jobs, message delivery, server errors and reconciliation."}
        actions={
          <Button type="button" variant="secondary" icon={<RefreshCw />} onClick={() => reload()}>
            Refresh
          </Button>
        }
      />

      {error && !data ? (
        <Card padding="none">
          <ErrorState message={error} onRetry={reload} />
        </Card>
      ) : (
        <>
          {data &&
            (data.readiness.status === "ok" ? (
              <Alert tone="success" icon={<CircleCheck />} title="Ready">
                The database, job queue and nightly reconciliation all pass their checks.
              </Alert>
            ) : (
              <Alert tone="danger" title="Not ready">
                {failing.map((c) => c!.detail).join(" ")}
              </Alert>
            ))}

          {data && data.alerts.length > 0 && (
            <Card>
              <CardHeader title="Open alerts" description="Problems the alert check found and has not seen resolved" icon={<BellRing />} />
              <ul className="divide-y divide-border">
                {data.alerts.map((a) => (
                  <li key={a.key} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-start sm:gap-3">
                    <StatusPill status={a.severity} tone={a.severity === "critical" ? "danger" : "warning"} label={a.severity === "critical" ? "Critical" : "Warning"} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-fg">{a.summary}</span>
                      {a.detail && <span className="block text-[13px] text-fg-muted">{a.detail}</span>}
                    </span>
                    <span className="text-xs text-fg-muted">
                      Since {when(a.openedAt)}, {a.notifications ? `told ${plural(a.notifications, "time")}` : "not delivered yet"}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <StatGrid>
            <KpiCard
              label="Jobs due now"
              value={data ? num(checks?.jobs?.due ?? 0) : ""}
              icon={<Inbox />}
              tone={checks?.jobs && !checks.jobs.ok ? "danger" : "primary"}
              hint={checks?.jobs ? `Oldest waited ${minutes(checks.jobs.lagSeconds)}` : undefined}
              loading={loading}
            />
            <KpiCard
              label="Failed jobs"
              value={data ? num(deadCount) : ""}
              icon={<Skull />}
              tone={deadCount ? "danger" : "success"}
              hint={data ? `${num(data.queues.reduce((n, q) => n + q.dead24h, 0))} in the last 24 hours` : undefined}
              loading={loading}
            />
            <KpiCard
              label="Message failures (24h)"
              value={data ? num(data.messages.failed) : ""}
              icon={<MessageSquareWarning />}
              tone={data?.messages.failed ? "warning" : "success"}
              hint={data ? `${percent(data.messages.failed, data.messages.total)} of ${num(data.messages.total)} messages` : undefined}
              loading={loading}
            />
            <KpiCard
              label="Server errors (24h)"
              value={data ? num(data.apiErrors.total) : ""}
              icon={<ServerCrash />}
              tone={data?.apiErrors.total ? "warning" : "success"}
              hint="5xx answers from the API"
              loading={loading}
            />
          </StatGrid>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader title="Readiness" description="What /api/health/ready checks" icon={<Activity />} />
              {!data ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <ul className="divide-y divide-border">
                  <CheckRow label="Database" check={checks?.database} />
                  <CheckRow label="Job queue" check={checks?.jobs} />
                  <CheckRow label="Nightly reconciliation" check={checks?.reconciliation} />
                </ul>
              )}
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader title="Server errors" description="5xx answers per hour, last 24 hours (UTC)" />
              {!data ? (
                <Skeleton className="h-[220px] w-full" />
              ) : (
                <BarChart
                  label="Server errors per hour"
                  categories={data.apiErrors.hours.map((h) => h.hour.slice(11, 13))}
                  series={[{ name: "Server errors", values: data.apiErrors.hours.map((h) => h.count) }]}
                  showLegend={false}
                />
              )}
            </Card>
          </div>

          <Card padding="none">
            <div className="px-5 pt-5">
              <CardHeader title="Job queues" description="Every background queue, right now" />
            </div>
            <DataTable
              bare
              label="Job queues"
              columns={queueColumns}
              data={data?.queues}
              getRowId={(q) => q.queue}
              error={error}
              onRetry={reload}
              pageSize={0}
              skeletonRows={4}
              defaultSort={{ id: "dead", dir: "desc" }}
              empty={{ title: "No jobs yet", description: "Queues appear once a background job has been queued." }}
            />
          </Card>

          <Card padding="none">
            <div className="px-5 pt-5">
              <CardHeader title="Failed jobs" description="Jobs that used every attempt, newest first. Retry gives one a fresh set of attempts." />
            </div>
            <DataTable
              bare
              label="Failed jobs"
              columns={deadColumns}
              data={data?.deadJobs}
              getRowId={(j) => j.id}
              error={error}
              onRetry={reload}
              pageSize={10}
              skeletonRows={3}
              empty={{ title: "No failed jobs", description: "Every background job finished or is still being retried." }}
            />
          </Card>

          {data && data.retryingJobs.length > 0 && (
            <Card padding="none">
              <div className="px-5 pt-5">
                <CardHeader title="Being retried" description="Jobs that failed an attempt and will run again" />
              </div>
              <DataTable bare label="Jobs being retried" columns={retryingColumns} data={data.retryingJobs} getRowId={(j) => j.id} pageSize={10} />
            </Card>
          )}

          <Card padding="none">
            <div className="px-5 pt-5">
              <CardHeader title="Message delivery failures" description="Schools with failed WhatsApp or SMS messages in the last 24 hours" />
            </div>
            <DataTable
              bare
              label="Message delivery failures by school"
              columns={messageColumns}
              data={data?.messages.bySchool}
              getRowId={(s) => s.schoolId}
              error={error}
              onRetry={reload}
              pageSize={10}
              skeletonRows={3}
              defaultSort={{ id: "failed", dir: "desc" }}
              empty={{ title: "No failed messages", description: "Every message in the last 24 hours was sent or is still queued." }}
            />
          </Card>

          <Card padding="none">
            <div className="px-5 pt-5">
              <CardHeader
                title="Payment reconciliation"
                description={
                  data
                    ? `${checks?.reconciliation?.detail ?? ""}${data.reconciliation.failedRuns24h ? ` ${plural(data.reconciliation.failedRuns24h, "run")} failed in the last 24 hours.` : ""}`
                    : "The latest reconciliation of each gateway, across schools"
                }
              />
            </div>
            <DataTable
              bare
              label="Last reconciliation per gateway"
              columns={gatewayColumns}
              data={data?.reconciliation.gateways}
              getRowId={(g) => g.provider}
              error={error}
              onRetry={reload}
              pageSize={0}
              skeletonRows={3}
            />
          </Card>
        </>
      )}
    </div>
  );
}
