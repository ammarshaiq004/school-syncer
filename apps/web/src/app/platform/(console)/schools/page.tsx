"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Building, Plus } from "lucide-react";
import { Avatar, Button, DataTable, NativeSelect, PageHeader, type Column } from "@/components/ui";
import { CreateSchoolDialog } from "@/components/platform/create-school-dialog";
import { day, rupees } from "@/lib/format";
import { usePlatformApi } from "@/lib/use-api";
import { StatusBadge, STATUS_OPTIONS, statusLabel, trialEnded } from "../status";

// The list can also be narrowed to trials that have run out and to schools with a
// bill 30 or more days past due (both worked out by the API).
const FILTER_OPTIONS = [
  ...STATUS_OPTIONS.slice(0, 1),
  { value: "TRIAL_ENDED", label: statusLabel("TRIAL_ENDED") },
  ...STATUS_OPTIONS.slice(1),
  { value: "OVERDUE_30", label: "30+ days overdue" },
];

interface SchoolRow {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  createdAt: string;
  plan: string | null;
  status: string | null;
  trialEndsAt: string | null;
  students: number;
  campuses: number;
  monthly: number;
  balanceDue: number;
  /** Days since the oldest unpaid bill fell due; 0 when nothing is overdue. */
  daysOverdue: number;
  lastLoginAt: string | null;
}

const columns: Column<SchoolRow>[] = [
  {
    id: "name",
    header: "School",
    sortValue: (s) => s.name,
    cell: (s) => (
      <span className="flex min-w-0 items-center gap-3">
        <Avatar name={s.name} size="sm" />
        <span className="min-w-0">
          <Link href={`/platform/schools/${s.id}`} className="block truncate font-medium text-fg hover:text-brand">
            {s.name}
          </Link>
          <span className="block truncate text-xs text-fg-muted">
            {s.slug}
            {s.city && `, ${s.city}`}
          </span>
        </span>
      </span>
    ),
  },
  { id: "plan", header: "Plan", sortValue: (s) => s.plan, cell: (s) => s.plan ?? "–", hideBelow: "md" },
  {
    id: "status",
    header: "Status",
    sortValue: (s) => s.status,
    cell: (s) => (
      <span className="flex flex-col items-start gap-0.5">
        {trialEnded(s) ? (
          <>
            <StatusBadge status="TRIAL_ENDED" />
            <span className="text-xs font-medium text-warning-text">ended {day(s.trialEndsAt!)}</span>
          </>
        ) : (
          <>
            <StatusBadge status={s.status} />
            {s.status === "TRIAL" && s.trialEndsAt && <span className="text-xs text-fg-muted">until {day(s.trialEndsAt)}</span>}
          </>
        )}
      </span>
    ),
  },
  { id: "students", header: "Students", align: "right", sortValue: (s) => s.students, cell: (s) => s.students.toLocaleString("en-PK") },
  { id: "campuses", header: "Campuses", align: "right", sortValue: (s) => s.campuses, cell: (s) => s.campuses, hideBelow: "lg" },
  {
    id: "monthly",
    header: "Per month",
    align: "right",
    sortValue: (s) => s.monthly,
    cell: (s) => (s.status === "TRIAL" ? <span className="text-fg-muted">{rupees(s.monthly)}</span> : rupees(s.monthly)),
    hideBelow: "md",
  },
  {
    id: "owed",
    header: "Owed",
    align: "right",
    sortValue: (s) => s.balanceDue,
    cell: (s) =>
      s.balanceDue ? (
        <span className="flex flex-col items-end gap-0.5">
          <span className="font-medium text-danger-text">{rupees(s.balanceDue)}</span>
          {s.daysOverdue > 0 && (
            <span className="whitespace-nowrap text-xs text-fg-muted">
              {s.daysOverdue} {s.daysOverdue === 1 ? "day" : "days"} overdue
            </span>
          )}
        </span>
      ) : (
        <span className="text-fg-muted">–</span>
      ),
  },
  {
    id: "login",
    header: "Last sign-in",
    sortValue: (s) => s.lastLoginAt,
    cell: (s) => (s.lastLoginAt ? day(s.lastLoginAt) : <span className="text-fg-muted">Never</span>),
    hideBelow: "lg",
  },
  { id: "joined", header: "Joined", sortValue: (s) => s.createdAt, cell: (s) => day(s.createdAt), hideBelow: "lg" },
];

export default function SchoolsPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  // Links from the overview pass ?status=... (the console only renders in the browser).
  const [status, setStatus] = useState(() => new URLSearchParams(window.location.search).get("status") ?? "");
  const query = new URLSearchParams({ ...(search && { search }), ...(status && { status }) }).toString();
  const schools = usePlatformApi<SchoolRow[]>(`/schools${query ? `?${query}` : ""}`);
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Schools"
        description="Every school on SchoolSyncer, with its plan, usage and balance."
        actions={
          <Button icon={<Plus />} onClick={() => setCreating(true)}>
            Add school
          </Button>
        }
      />
      <DataTable
        label="Schools"
        columns={columns}
        data={schools.data}
        getRowId={(s) => s.id}
        error={schools.error}
        onRetry={schools.reload}
        search={search}
        onSearchChange={setSearch}
        manualFiltering
        searchPlaceholder="Search name, code, email or phone"
        filters={
          <NativeSelect
            aria-label="Status"
            placeholder="Every status"
            options={FILTER_OPTIONS}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            wrapperClassName="w-40"
          />
        }
        filtered={!!status || !!search}
        empty={{ icon: <Building />, title: "No schools match", description: "Try another search or status." }}
        onRowClick={(s) => router.push(`/platform/schools/${s.id}`)}
        getRowLabel={(s) => `Open ${s.name}`}
      />
      <CreateSchoolDialog open={creating} onOpenChange={setCreating} onCreated={schools.reload} />
    </div>
  );
}
