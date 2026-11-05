"use client";

import { useState } from "react";
import { Smartphone, UserCheck, UserX, Users } from "lucide-react";
import { Badge, DataTable, ErrorState, KpiCard, NativeSelect, PageHeader, StatGrid, StatusPill, type Column, type Tone } from "@/components/ui";
import { day } from "@/lib/format";
import { hasRole, SETUP, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

type Status = "NO_ACCOUNT" | "NEVER" | "INACTIVE" | "ACTIVE";
interface Family {
  id: string;
  name: string;
  phone: string;
  status: Status;
  lastSeen: string | null;
  students: { name: string; className: string }[];
}
interface Stats {
  totals: { families: number; noAccount: number; never: number; inactive: number; active: number; active7: number };
  daily: { date: string; parents: number }[];
  byClass: { className: string; families: number; withLogin: number; active: number }[];
  families: Family[];
}

const LABEL: Record<Status, string> = { NO_ACCOUNT: "No login yet", NEVER: "Never signed in", INACTIVE: "Not seen for 30 days", ACTIVE: "Active" };
const TONE: Record<Status, Tone> = { NO_ACCOUNT: "danger", NEVER: "warning", INACTIVE: "warning", ACTIVE: "success" };
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "-");

export default function ParentLoginsPage() {
  const user = useSession();
  const stats = useApi<Stats>("/school/parent-logins");
  const [status, setStatus] = useState("");
  const s = stats.data;
  const peak = Math.max(1, ...(s?.daily.map((d) => d.parents) ?? []));

  const columns: Column<Family>[] = [
    { id: "name", header: "Parent", sortValue: (f) => f.name, cell: (f) => <span className="block font-medium text-fg">{f.name}<span className="block text-xs font-normal text-fg-muted">{f.phone}</span></span> },
    { id: "children", header: "Children", cell: (f) => f.students.map((c) => `${c.name} (${c.className})`).join(", "), hideBelow: "md" },
    { id: "status", header: "App use", sortValue: (f) => f.status, cell: (f) => <StatusPill status={f.status} tone={TONE[f.status]} label={LABEL[f.status]} /> },
    { id: "seen", header: "Last seen", sortValue: (f) => f.lastSeen ?? "", cell: (f) => (f.lastSeen ? day(f.lastSeen) : "Never") },
  ];

  const classColumns: Column<Stats["byClass"][number]>[] = [
    { id: "class", header: "Class", sortValue: (c) => c.className, cell: (c) => <span className="font-medium text-fg">{c.className}</span> },
    { id: "families", header: "Families", align: "right", sortValue: (c) => c.families, cell: (c) => c.families },
    { id: "login", header: "Have a login", align: "right", sortValue: (c) => c.withLogin, cell: (c) => `${c.withLogin} (${pct(c.withLogin, c.families)})` },
    { id: "active", header: "Active in 30 days", align: "right", sortValue: (c) => c.active, cell: (c) => `${c.active} (${pct(c.active, c.families)})` },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Parent app usage"
        description="Which families have a parent login, who signed in, and who has gone quiet."
        breadcrumbs={[{ label: "Communication" }, { label: "Parent app usage" }]}
      />
      {!hasRole(user, SETUP) ? (
        <ErrorState compact title="Not allowed" message="Only school admins can see parent login statistics." />
      ) : stats.error ? (
        <ErrorState compact message={stats.error} onRetry={stats.reload} />
      ) : (
        <>
          <StatGrid>
            <KpiCard label="Families" value={s?.totals.families ?? 0} icon={<Users />} loading={!s} hint="With a current student" />
            <KpiCard label="Active in 30 days" value={s?.totals.active ?? 0} icon={<UserCheck />} tone="success" loading={!s} hint={s ? `${pct(s.totals.active, s.totals.families)} of families` : undefined} />
            <KpiCard label="Active this week" value={s?.totals.active7 ?? 0} icon={<Smartphone />} tone="info" loading={!s} />
            <KpiCard label="Never signed in" value={(s?.totals.never ?? 0) + (s?.totals.noAccount ?? 0)} icon={<UserX />} tone="warning" loading={!s} hint={s ? `${s.totals.noAccount} have no login yet` : undefined} />
          </StatGrid>

          {s && (
            <figure className="rounded-xl border border-border bg-surface p-4">
              <figcaption className="mb-3 text-sm font-medium text-fg">Parents who opened the app each day, last 30 days</figcaption>
              <div className="flex h-28 items-end gap-1" role="img" aria-label={`Parents per day, busiest day ${peak}`}>
                {s.daily.map((d) => (
                  <div key={d.date} className="flex-1 rounded-t bg-primary" style={{ height: `${(d.parents / peak) * 100}%`, minHeight: 2 }} title={`${d.date}: ${d.parents}`} />
                ))}
              </div>
            </figure>
          )}

          <DataTable label="Usage by class" columns={classColumns} data={s?.byClass ?? null} getRowId={(c) => c.className} empty={{ title: "No families yet" }} />

          <DataTable
            label="Families"
            columns={columns}
            data={s ? s.families.filter((f) => !status || f.status === status) : null}
            getRowId={(f) => f.id}
            getSearchText={(f) => `${f.name} ${f.phone} ${f.students.map((c) => c.name).join(" ")}`}
            searchPlaceholder="Search parent, phone or child"
            filters={<NativeSelect aria-label="App use" placeholder="Every family" value={status} onChange={(e) => setStatus(e.target.value)} options={(Object.keys(LABEL) as Status[]).map((k) => ({ value: k, label: LABEL[k] }))} wrapperClassName="w-52" />}
            filtered={!!status}
            toolbarActions={s && s.totals.noAccount > 0 ? <Badge tone="warning">Give logins from a student&apos;s profile or the bulk login tool</Badge> : undefined}
            empty={{ title: "No families match" }}
          />
        </>
      )}
    </div>
  );
}
