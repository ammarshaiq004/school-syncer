"use client";

import { useState } from "react";
import { CircleCheck, Eye, MessageSquare, TriangleAlert } from "lucide-react";
import { Alert, DataTable, ErrorState, KpiCard, NativeSelect, PageHeader, StatGrid, type Column } from "@/components/ui";
import { MessagesNav } from "@/components/messages/messages-nav";
import { hasRole, SETUP, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

interface Report {
  from: string;
  to: string;
  totals: { total: number; sent: number; failed: number; queued: number; notDelivered: number; delivered: number; read: number };
  byTemplate: { template: string; total: number; sent: number; failed: number; delivered: number; read: number }[];
  byDay: { date: string; count: number }[];
  topErrors: { error: string; count: number }[];
  inbox: { received: number; replied: number };
}

const RANGES = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

const label = (t: string) => {
  const s = t.replace(/[._]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const pct = (n: number, of: number) => (of ? `${((n / of) * 100).toFixed(0)}%` : "-");

export default function ReportPage() {
  const user = useSession();
  const [days, setDays] = useState("30");
  const start = new Date();
  start.setDate(start.getDate() - (Number(days) - 1));
  const to = new Date().toLocaleDateString("en-CA");
  const from = start.toLocaleDateString("en-CA");
  const report = useApi<Report>(`/whatsapp/report?from=${from}&to=${to}`);
  const r = report.data;
  const peak = Math.max(1, ...(r?.byDay.map((d) => d.count) ?? []));

  const columns: Column<Report["byTemplate"][number]>[] = [
    { id: "type", header: "Message", sortValue: (t) => t.template, cell: (t) => <span className="font-medium text-fg">{label(t.template)}</span> },
    { id: "total", header: "Sent out", align: "right", sortValue: (t) => t.total, cell: (t) => t.total },
    { id: "accepted", header: "Accepted", align: "right", sortValue: (t) => t.sent, cell: (t) => `${t.sent} (${pct(t.sent, t.total)})` },
    { id: "delivered", header: "Delivered", align: "right", sortValue: (t) => t.delivered, cell: (t) => `${t.delivered} (${pct(t.delivered, t.total)})`, hideBelow: "md" },
    { id: "read", header: "Read", align: "right", sortValue: (t) => t.read, cell: (t) => `${t.read} (${pct(t.read, t.total)})`, hideBelow: "md" },
    { id: "failed", header: "Failed", align: "right", sortValue: (t) => t.failed, cell: (t) => (t.failed ? <span className="font-medium text-danger-text">{t.failed}</span> : 0) },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Delivery report"
        description="How many messages went out, reached parents and were read."
        breadcrumbs={[{ label: "Communication" }, { label: "Message log" }, { label: "Delivery report" }]}
        actions={<NativeSelect aria-label="Period" value={days} onChange={(e) => setDays(e.target.value)} options={RANGES} wrapperClassName="w-40" />}
      />
      <MessagesNav />
      {!hasRole(user, SETUP) ? (
        <ErrorState compact title="Not allowed" message="Only school admins can see the delivery report." />
      ) : report.error ? (
        <ErrorState compact message={report.error} onRetry={report.reload} />
      ) : (
        <>
          <StatGrid>
            <KpiCard label="Messages" value={r?.totals.total ?? 0} icon={<MessageSquare />} loading={!r} hint={r ? `${r.inbox.received} replies received` : undefined} />
            <KpiCard label="Accepted" value={r?.totals.sent ?? 0} icon={<CircleCheck />} tone="success" loading={!r} hint={r ? `${pct(r.totals.sent, r.totals.total)} of all` : undefined} />
            <KpiCard label="Read by parents" value={r?.totals.read ?? 0} icon={<Eye />} tone="info" loading={!r} hint={r ? `${r.totals.delivered} delivered` : "WhatsApp only"} />
            <KpiCard label="Failed" value={r?.totals.failed ?? 0} icon={<TriangleAlert />} tone="danger" loading={!r} />
          </StatGrid>
          {r && r.totals.notDelivered > 0 && (
            <Alert tone="warning">{r.totals.notDelivered} messages were only logged because no WhatsApp number or SMS gateway is set up.</Alert>
          )}
          {r && r.topErrors.length > 0 && (
            <Alert tone="danger" title="Why messages failed">
              <ul className="list-disc pl-5">
                {r.topErrors.map((e) => (
                  <li key={e.error}>
                    {e.count} × {e.error}
                  </li>
                ))}
              </ul>
            </Alert>
          )}
          <DataTable label="Messages by type" columns={columns} data={r?.byTemplate ?? null} getRowId={(t) => t.template} empty={{ title: "No messages in this period" }} />
          {r && r.byDay.length > 0 && (
            <figure className="rounded-xl border border-border bg-surface p-4">
              <figcaption className="mb-3 text-sm font-medium text-fg">Messages per day</figcaption>
              <div className="flex h-32 items-end gap-1" role="img" aria-label={`Messages per day, busiest day ${peak}`}>
                {r.byDay.map((d) => (
                  <div key={d.date} className="flex-1 rounded-t bg-primary" style={{ height: `${(d.count / peak) * 100}%`, minHeight: 2 }} title={`${d.date}: ${d.count}`} />
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-fg-muted">
                <span>{r.byDay[0].date}</span>
                <span>{r.byDay.at(-1)!.date}</span>
              </div>
            </figure>
          )}
        </>
      )}
    </div>
  );
}
