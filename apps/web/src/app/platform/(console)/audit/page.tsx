"use client";

import Link from "next/link";
import { useState } from "react";
import { ScrollText } from "lucide-react";
import { DataTable, DescriptionList, Drawer, NativeSelect, PageHeader, type Column } from "@/components/ui";
import { auditIcon, auditLabel, auditReason } from "@/components/platform/audit-actions";
import { when } from "@/components/platform/session";
import { usePlatformApi } from "@/lib/use-api";

interface Entry {
  id: string;
  action: string;
  createdAt: string;
  details: unknown;
  admin: { id: string; name: string } | null;
  schoolId: string | null;
  school: { id: string; name: string; slug: string } | null;
}

interface AuditPage {
  items: Entry[];
  total: number;
  page: number;
  pageSize: number;
  actions: string[];
  /** Staff members who appear in the log, for the filter. */
  actors: { id: string; name: string }[];
}

const columns: Column<Entry>[] = [
  {
    id: "when",
    header: "When",
    cell: (e) => (
      <time dateTime={e.createdAt} className="whitespace-nowrap tabular-nums text-fg-secondary">
        {when(e.createdAt)}
      </time>
    ),
  },
  {
    id: "action",
    header: "Action",
    cell: (e) => {
      const Icon = auditIcon(e.action);
      const reason = auditReason(e.details);
      return (
        <span className="flex min-w-0 items-start gap-2.5">
          <Icon className="mt-0.5 size-4 shrink-0 text-fg-muted" aria-hidden />
          <span className="min-w-0">
            <span className="block text-fg">{auditLabel(e.action)}</span>
            {reason && <span className="block truncate text-xs text-fg-muted">Reason: {reason}</span>}
          </span>
        </span>
      );
    },
  },
  {
    id: "school",
    header: "School",
    cell: (e) =>
      e.school ? (
        <Link href={`/platform/schools/${e.school.id}`} className="font-medium text-fg hover:text-brand">
          {e.school.name}
        </Link>
      ) : (
        <span className="text-fg-muted">Console</span>
      ),
    hideBelow: "sm",
  },
  { id: "admin", header: "By", cell: (e) => e.admin?.name ?? <span className="text-fg-muted">System</span>, hideBelow: "md" },
];

/** Every change made from the console, filterable by school, staff member and action. */
export default function PlatformAuditPage() {
  // Links from a school page pass ?schoolId=... (the console only renders in the browser).
  const [schoolId, setSchoolId] = useState(() => new URLSearchParams(window.location.search).get("schoolId") ?? "");
  const [adminId, setAdminId] = useState("");
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Entry | null>(null);

  const query = new URLSearchParams({ page: String(page), ...(schoolId && { schoolId }), ...(adminId && { adminId }), ...(action && { action }) });
  const audit = usePlatformApi<AuditPage>(`/audit?${query}`);
  const schools = usePlatformApi<{ id: string; name: string }[]>("/schools");

  const filter = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    set(e.target.value);
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Audit log" description="Every change made from the console, newest first." />
      <DataTable
        label="Console audit log"
        columns={columns}
        data={audit.data?.items}
        getRowId={(e) => e.id}
        error={audit.error}
        onRetry={audit.reload}
        filters={
          <>
            <NativeSelect
              aria-label="School"
              placeholder="Every school"
              options={(schools.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
              value={schoolId}
              onChange={filter(setSchoolId)}
              wrapperClassName="w-52"
            />
            {audit.data && (
              <NativeSelect
                aria-label="Staff member"
                placeholder="Every staff member"
                options={audit.data.actors.map((s) => ({ value: s.id, label: s.name }))}
                value={adminId}
                onChange={filter(setAdminId)}
                wrapperClassName="w-48"
              />
            )}
            <NativeSelect
              aria-label="Action"
              placeholder="Every action"
              options={[{ value: "school.", label: "Any school change" }, ...(audit.data?.actions ?? []).map((a) => ({ value: a, label: auditLabel(a) }))]}
              value={action}
              onChange={filter(setAction)}
              wrapperClassName="w-56"
            />
          </>
        }
        filtered={!!(schoolId || adminId || action)}
        serverPagination={audit.data ? { page: audit.data.page, pageSize: audit.data.pageSize, total: audit.data.total, onPageChange: setPage } : undefined}
        empty={{ icon: <ScrollText />, title: "Nothing recorded", description: "Console changes matching these filters show here." }}
        onRowClick={setOpen}
        getRowLabel={(e) => `Details of ${auditLabel(e.action)}`}
      />

      <Drawer
        open={!!open}
        onOpenChange={(o) => !o && setOpen(null)}
        title={open ? auditLabel(open.action) : ""}
        description={open ? when(open.createdAt) : undefined}
      >
        {open && (
          <div className="flex flex-col gap-5">
            <DescriptionList
              columns={1}
              items={[
                { label: "By", value: open.admin?.name ?? "System" },
                { label: "School", value: open.school ? `${open.school.name} (${open.school.slug})` : "Console" },
                { label: "Action code", value: <span className="font-mono text-[13px]">{open.action}</span> },
                ...(auditReason(open.details) ? [{ label: "Reason", value: auditReason(open.details) }] : []),
              ]}
            />
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-fg-secondary">Details</span>
              <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-surface-2 p-3 font-mono text-xs text-fg">
                {JSON.stringify(open.details ?? {}, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
