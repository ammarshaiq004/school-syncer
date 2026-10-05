"use client";

import { useMemo, useState } from "react";
import { History, Monitor, ShieldCheck, X } from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  DataTable,
  DescriptionList,
  Drawer,
  Input,
  NativeSelect,
  Switch,
  humanize,
  type Column,
} from "@/components/ui";
import type { StaffUser } from "@/components/staff/types";
import { cn } from "@/lib/cn";
import { useApi } from "@/lib/use-api";

export interface AuditEntry {
  id: string;
  userId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
  actor: { kind: "user" | "platform" | "system"; id: string | null; name: string };
}

interface AuditPage {
  items: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
}

const ACTION_LABELS: Record<string, string> = {
  "user.create": "Added a staff login",
  "user.update": "Changed a staff login",
  "user.activate": "Activated an account",
  "user.deactivate": "Deactivated an account",
  "user.reset_password": "Reset a password",
  "role.create": "Created a custom role",
  "role.update": "Changed a custom role",
  "role.delete": "Deleted a custom role",
  "role.duplicate": "Duplicated a custom role",
  "role.builtin.update": "Changed built-in role access",
  "school.update": "Changed school settings",
  "platform.support_login": "SchoolSyncer support session",
};

const ENTITY_LABELS: Record<string, string> = {
  User: "Staff login",
  CustomRole: "Custom role",
  BuiltinRolePermission: "Built-in role",
  School: "School settings",
};

export const actionLabel = (a: string) => ACTION_LABELS[a] ?? humanize(a.replace(/\./g, " "));
const entityLabel = (e: string) => ENTITY_LABELS[e] ?? humanize(e.replace(/([a-z])([A-Z])/g, "$1 $2"));

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Karachi" });

const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

interface DiffRow {
  field: string;
  before: unknown;
  after: unknown;
  changed: boolean;
}

/** Field-by-field comparison of before and after (one level deep; nested values compared as JSON). */
export function diffEntries(before: unknown, after: unknown): DiffRow[] {
  const b = asRecord(before);
  const a = asRecord(after);
  if (!b && !a) return [];
  const keys = [...new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})])];
  return keys.map((field) => {
    const bv = b ? b[field] : undefined;
    const av = a ? a[field] : undefined;
    return { field, before: bv, after: av, changed: JSON.stringify(bv) !== JSON.stringify(av) };
  });
}

function Value({ v, tone }: { v: unknown; tone: "before" | "after" }) {
  if (v === undefined) return <span className="text-fg-disabled">Not recorded</span>;
  if (v === null || v === "") return <span className="text-fg-muted">Empty</span>;
  if (typeof v === "object")
    return (
      <pre className={cn("max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md px-2 py-1.5 font-mono text-xs", tone === "before" ? "bg-danger-tint" : "bg-success-tint")}>
        {JSON.stringify(v, null, 2)}
      </pre>
    );
  return <span className="break-words">{String(v)}</span>;
}

/** School audit log with filters and a before/after drawer. */
export function AuditLog() {
  const [entity, setEntity] = useState("");
  const [action, setAction] = useState("");
  const [userId, setUserId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [open, setOpen] = useState<AuditEntry | null>(null);

  const query = useMemo(() => {
    const q = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (entity) q.set("entity", entity);
    if (action) q.set("action", action);
    if (userId) q.set("userId", userId);
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    return q.toString();
  }, [entity, action, userId, from, to, page, pageSize]);

  // Typed dates skip min/max, so a reversed range is caught here instead of sending a request the API rejects.
  const badRange = !!(from && to && from > to);
  const log = useApi<AuditPage>(badRange ? null : `/audit?${query}`);
  const facets = useApi<{ entities: string[]; actions: string[] }>("/audit/facets");
  const users = useApi<StaffUser[]>("/users?type=staff");
  const dataForQuery = badRange ? [] : log.data && log.data.page === page ? log.data.items : null;
  const filtered = !!(entity || action || userId || from || to);

  /** Changing a filter goes back to page 1. */
  const filter = (set: (v: string) => void) => (v: string) => {
    set(v);
    setPage(1);
  };

  function clearFilters() {
    setEntity("");
    setAction("");
    setUserId("");
    setFrom("");
    setTo("");
    setPage(1);
  }

  const columns: Column<AuditEntry>[] = [
    { id: "when", header: "When", cell: (e) => <span className="whitespace-nowrap tabular-nums text-fg-secondary">{dateTime(e.createdAt)}</span> },
    {
      id: "who",
      header: "Who",
      cell: (e) => (
        <span className="flex items-center gap-2">
          {e.actor.kind === "user" ? (
            <Avatar name={e.actor.name} size="xs" />
          ) : (
            <span className="grid size-6 place-items-center rounded-full bg-surface-3 text-fg-muted [&_svg]:size-3.5">
              {e.actor.kind === "platform" ? <ShieldCheck aria-hidden /> : <Monitor aria-hidden />}
            </span>
          )}
          <span className="truncate font-medium text-fg">{e.actor.name}</span>
        </span>
      ),
    },
    { id: "action", header: "Action", cell: (e) => actionLabel(e.action) },
    {
      id: "record",
      header: "Record",
      hideBelow: "md",
      cell: (e) => (
        <span className="flex items-center gap-2">
          <Badge tone="neutral">{entityLabel(e.entity)}</Badge>
        </span>
      ),
    },
    {
      id: "changes",
      header: "Changes",
      align: "right",
      hideBelow: "sm",
      cell: (e) => {
        const n = diffEntries(e.before, e.after).filter((d) => d.changed).length;
        return n ? `${n} ${n === 1 ? "field" : "fields"}` : <span className="text-fg-muted">None recorded</span>;
      },
    },
  ];

  const userOptions = [
    { value: "platform", label: "SchoolSyncer support" },
    ...(users.data ?? []).map((u) => ({ value: u.id, label: u.name })),
  ];

  return (
    <>
      <DataTable
        label="Audit log"
        columns={columns}
        data={dataForQuery}
        getRowId={(e) => e.id}
        error={badRange ? null : log.error}
        errorStatus={log.errorStatus}
        onRetry={log.reload}
        loading={!dataForQuery && !log.error && !badRange}
        manualFiltering
        filters={
          <>
            <NativeSelect
              aria-label="Filter by record type"
              placeholder="All records"
              options={(facets.data?.entities ?? []).map((v) => ({ value: v, label: entityLabel(v) }))}
              value={entity}
              onChange={(e) => filter(setEntity)(e.target.value)}
              wrapperClassName="w-40"
            />
            <NativeSelect
              aria-label="Filter by action"
              placeholder="All actions"
              options={(facets.data?.actions ?? []).map((v) => ({ value: v, label: actionLabel(v) }))}
              value={action}
              onChange={(e) => filter(setAction)(e.target.value)}
              wrapperClassName="w-52"
            />
            <NativeSelect
              aria-label="Filter by person"
              placeholder="Everyone"
              options={userOptions}
              value={userId}
              onChange={(e) => filter(setUserId)(e.target.value)}
              wrapperClassName="w-44"
            />
            <Input type="date" aria-label="From date" value={from} max={to || undefined} onChange={(e) => filter(setFrom)(e.target.value)} className="h-9 w-40" />
            <Input
              type="date"
              aria-label="To date"
              value={to}
              min={from || undefined}
              onChange={(e) => filter(setTo)(e.target.value)}
              className="h-9 w-40"
              aria-invalid={badRange || undefined}
              aria-describedby={badRange ? "audit-range-error" : undefined}
            />
            {badRange && (
              <span id="audit-range-error" role="alert" className="self-center text-[13px] text-danger-text">
                The From date must be on or before the To date.
              </span>
            )}
            {filtered && (
              <Button type="button" variant="ghost" size="sm" icon={<X />} onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </>
        }
        filtered={filtered}
        empty={{
          icon: <History />,
          title: filtered ? "Nothing matches these filters" : "No activity recorded yet",
          description: filtered ? "Try a wider date range or clear the filters." : "Changes to staff, roles and school settings show up here.",
        }}
        serverPagination={{
          page,
          pageSize,
          total: badRange ? 0 : (log.data?.total ?? 0),
          onPageChange: setPage,
          onPageSizeChange: (n) => (setPageSize(n), setPage(1)),
          pageSizeOptions: [25, 50, 100],
        }}
        onRowClick={setOpen}
        getRowLabel={(e) => `${actionLabel(e.action)} by ${e.actor.name}, ${dateTime(e.createdAt)}. Show details`}
      />
      <AuditDrawer entry={open} onOpenChange={(o) => !o && setOpen(null)} />
    </>
  );
}

function AuditDrawer({ entry, onOpenChange }: { entry: AuditEntry | null; onOpenChange: (open: boolean) => void }) {
  const [showAll, setShowAll] = useState(false);
  const rows = entry ? diffEntries(entry.before, entry.after) : [];
  const shown = showAll ? rows : rows.filter((r) => r.changed);
  const hasPayload = entry && (entry.before != null || entry.after != null);

  return (
    <Drawer open={!!entry} onOpenChange={onOpenChange} size="xl" title={entry ? actionLabel(entry.action) : "Change details"} description={entry ? `${entry.actor.name}, ${dateTime(entry.createdAt)}` : undefined}>
      {entry && (
        <div className="flex flex-col gap-6">
          <DescriptionList
            items={[
              { label: "Done by", value: entry.actor.name },
              { label: "When", value: dateTime(entry.createdAt) },
              { label: "Record", value: entityLabel(entry.entity) },
              { label: "Record ID", value: entry.entityId ? <code className="break-all font-mono text-xs">{entry.entityId}</code> : <span className="text-fg-muted">None</span> },
              { label: "Action code", value: <code className="font-mono text-xs">{entry.action}</code> },
            ]}
          />

          <section aria-labelledby="audit-diff" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 id="audit-diff" className="text-sm font-semibold text-fg">
                What changed
              </h3>
              {rows.length > 0 && <Switch checked={showAll} onCheckedChange={setShowAll} label="Show unchanged fields" />}
            </div>
            {!hasPayload || rows.length === 0 ? (
              <p className="text-sm text-fg-muted">No before or after details were recorded for this action.</p>
            ) : shown.length === 0 ? (
              <p className="text-sm text-fg-muted">No field values changed.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="bg-surface-2 text-left text-xs font-semibold text-fg-muted">
                    <tr>
                      <th scope="col" className="w-1/5 px-3 py-2">
                        Field
                      </th>
                      <th scope="col" className="w-2/5 px-3 py-2">
                        Before
                      </th>
                      <th scope="col" className="w-2/5 px-3 py-2">
                        After
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border align-top">
                    {shown.map((r) => (
                      <tr key={r.field} className={cn(!r.changed && "text-fg-muted")}>
                        <th scope="row" className="px-3 py-2 text-left font-medium">
                          {humanize(r.field.replace(/([a-z])([A-Z])/g, "$1_$2"))}
                          {r.changed && <span className="sr-only"> (changed)</span>}
                        </th>
                        <td className={cn("px-3 py-2", r.changed && "text-danger-text")}>
                          <Value v={r.before} tone="before" />
                        </td>
                        <td className={cn("px-3 py-2", r.changed && "text-success-text")}>
                          <Value v={r.after} tone="after" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {hasPayload && (
            <details className="group rounded-lg border border-border">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-fg-secondary hover:text-fg">Raw record (JSON)</summary>
              <div className="grid gap-3 border-t border-border p-3 lg:grid-cols-2">
                {(["before", "after"] as const).map((k) => (
                  <div key={k} className="min-w-0">
                    <p className="mb-1 text-xs font-semibold text-fg-muted">{k === "before" ? "Before" : "After"}</p>
                    <pre className="max-h-80 overflow-auto rounded-md bg-surface-2 p-2 font-mono text-xs text-fg">{JSON.stringify(entry[k], null, 2) ?? "null"}</pre>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </Drawer>
  );
}
