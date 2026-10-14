"use client";

import Link from "next/link";
import { useState } from "react";
import { CircleCheck, CircleSlash, Clock, MessageSquare, Send, TriangleAlert } from "lucide-react";
import { Alert, DataTable, KpiCard, NativeSelect, PageHeader, StatGrid, StatusPill, type Column, type Tone } from "@/components/ui";
import { STATUS_LABEL, STATUS_TONE, statusDetail } from "@/lib/message-status";
import { useApi } from "@/lib/use-api";

interface Log {
  id: string;
  channel: string;
  to: string;
  template: string;
  body: string;
  status: string;
  error: string | null;
  attempts: number;
  createdAt: string;
}

/** GET /notifications/delivery: who sends the school's messages now. */
interface Delivery {
  source: "school" | "platform" | "log";
  channel: string | null;
  delivers: boolean;
}

/** "feeReminder" or "FEE_REMINDER" -> "Fee reminder". */
function templateLabel(t: string) {
  const s = t.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function MessagesPage() {
  const logs = useApi<Log[]>("/notifications?take=200");
  const delivery = useApi<Delivery>("/notifications/delivery");
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");

  const all = logs.data ?? [];
  const loading = !logs.data && !logs.error;
  const sent = all.filter((l) => l.status === "SENT").length;
  const failed = all.filter((l) => l.status === "FAILED").length;
  const logged = all.filter((l) => l.status === "LOGGED").length;
  const queued = all.length - sent - failed - logged;
  const channels = [...new Set(all.map((l) => l.channel))];
  const rows = logs.data ? all.filter((l) => (!status || l.status === status) && (!channel || l.channel === channel)) : null;

  const columns: Column<Log>[] = [
    {
      id: "when",
      header: "When",
      sortValue: (l) => l.createdAt,
      cell: (l) => (
        <time dateTime={l.createdAt} className="whitespace-nowrap tabular-nums text-fg-secondary">
          {when(l.createdAt)}
        </time>
      ),
    },
    { id: "to", header: "To", sortValue: (l) => l.to, cell: (l) => <span className="whitespace-nowrap font-mono text-xs text-fg">{l.to}</span> },
    {
      id: "type",
      header: "Type",
      sortValue: (l) => l.template,
      cell: (l) => (
        <div className="whitespace-nowrap">
          <div className="font-medium text-fg">{templateLabel(l.template)}</div>
          <div className="text-xs text-fg-muted">{templateLabel(l.channel)}</div>
        </div>
      ),
      hideBelow: "md",
    },
    {
      id: "message",
      header: "Message",
      cell: (l) => (
        <div className="min-w-64 max-w-md py-1">
          <p className="line-clamp-3 text-fg-secondary" title={l.body}>
            {l.body}
          </p>
          {statusDetail(l) && (
            <p className={`mt-1 text-xs ${l.status === "FAILED" ? "text-danger-text" : "text-fg-muted"}`}>{statusDetail(l)}</p>
          )}
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      sortValue: (l) => l.status,
      cell: (l) => (
        <StatusPill
          status={l.status}
          tone={(STATUS_TONE as Record<string, Tone>)[l.status] ?? "warning"}
          label={STATUS_LABEL[l.status] ?? undefined}
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Message log"
        description="Every WhatsApp and SMS message the school has sent, newest first. Showing the last 200."
        breadcrumbs={[{ label: "Communication" }, { label: "Message log" }]}
      />

      {delivery.data && !delivery.data.delivers && (
        <Alert tone="warning" title="Messages are not being delivered">
          No WhatsApp number or SMS gateway is set up for your school, so messages are only recorded here and marked &quot;Not
          delivered&quot;. Add your WhatsApp Business number in{" "}
          <Link href="/settings?tab=messaging" className="font-medium underline">
            System settings &gt; Messaging
          </Link>
          .
        </Alert>
      )}

      <StatGrid>
        <KpiCard label="Messages" value={all.length.toLocaleString("en-PK")} icon={<MessageSquare />} loading={loading} hint="In this log" />
        <KpiCard label="Sent" value={sent.toLocaleString("en-PK")} icon={<CircleCheck />} tone="success" loading={loading} hint={all.length ? `${((sent / all.length) * 100).toFixed(1)}% accepted by WhatsApp or SMS` : undefined} />
        <KpiCard label="Queued" value={queued.toLocaleString("en-PK")} icon={<Clock />} tone="warning" loading={loading} />
        <KpiCard label="Failed" value={failed.toLocaleString("en-PK")} icon={<TriangleAlert />} tone="danger" loading={loading} hint={failed ? "Check the errors below" : "No failures"} />
        {logged > 0 && (
          <KpiCard label="Not delivered" value={logged.toLocaleString("en-PK")} icon={<CircleSlash />} tone="neutral" loading={loading} hint="No provider configured" />
        )}
      </StatGrid>

      <DataTable
        label="Message log"
        columns={columns}
        data={rows}
        error={logs.error}
        onRetry={logs.reload}
        getRowId={(l) => l.id}
        getSearchText={(l) => `${l.to} ${l.template} ${templateLabel(l.template)} ${l.body} ${l.error ?? ""}`}
        searchPlaceholder="Search number or message"
        filters={
          <>
            <NativeSelect
              aria-label="Status"
              placeholder="All statuses"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              options={[
                { value: "SENT", label: "Sent" },
                { value: "QUEUED", label: "Queued" },
                { value: "FAILED", label: "Failed" },
                { value: "LOGGED", label: "Not delivered" },
              ]}
              wrapperClassName="w-40"
            />
            {channels.length > 1 && (
              <NativeSelect
                aria-label="Channel"
                placeholder="All channels"
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                options={channels.map((c) => ({ value: c, label: templateLabel(c) }))}
                wrapperClassName="w-40"
              />
            )}
          </>
        }
        filtered={!!status || !!channel}
        empty={{ icon: <Send />, title: "No messages sent yet", description: "Attendance alerts, fee reminders and announcements sent on WhatsApp will be listed here." }}
        defaultSort={{ id: "when", dir: "desc" }}
      />
    </div>
  );
}
