"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, FileSpreadsheet, Phone, Plus } from "lucide-react";
import { Avatar, Button, buttonClass, DataTable, PageHeader, ProgressBar, StatusPill, type Column } from "@/components/ui";
import { cn } from "@/lib/cn";
import { rupees } from "@/lib/format";
import { useSectionOptions } from "@/lib/sections";
import { AddStudentDrawer } from "./add-student-drawer";
import {
  classLabel,
  FEE_STATUS_OPTIONS,
  rateTone,
  STATUS_OPTIONS,
  type DirectoryPage,
  type DirectoryRow,
} from "./directory-types";
import { MultiSelectFilter } from "./multi-select-filter";
import {
  StudentActionDialogs,
  StudentActionsMenu,
  useRecordPayment,
  type DirectoryPermissions,
  type StudentAction,
} from "./student-actions";
import { StudentDrawer } from "./student-drawer";
import { useKeyedApi } from "./use-keyed-api";

type SortKey = "name" | "admissionNo" | "attendance" | "class";
const SORTS: SortKey[] = ["name", "admissionNo", "attendance", "class"];
const PAGE_SIZES = [10, 25, 50, 100];

interface DirectoryQuery {
  page: number;
  pageSize: number;
  search: string;
  classId: string[];
  sectionId: string[];
  status: string[];
  feeStatus: string[];
  sort: SortKey;
  dir: "asc" | "desc";
}

const list = (v: string | null) => (v ? v.split(",").filter(Boolean) : []);

/** Reads the directory state from the address bar (bad values fall back to defaults). */
function readQuery(sp: URLSearchParams): DirectoryQuery {
  const page = Number(sp.get("page"));
  const pageSize = Number(sp.get("pageSize"));
  const sort = sp.get("sort") as SortKey;
  return {
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    pageSize: PAGE_SIZES.includes(pageSize) ? pageSize : 25,
    search: sp.get("search") ?? "",
    classId: list(sp.get("classId")),
    sectionId: list(sp.get("sectionId")),
    status: list(sp.get("status")),
    feeStatus: list(sp.get("feeStatus")),
    sort: SORTS.includes(sort) ? sort : "name",
    dir: sp.get("dir") === "desc" ? "desc" : "asc",
  };
}

/** Query string with defaults left out, so a plain /students stays clean. */
function writeQuery(q: DirectoryQuery) {
  const p = new URLSearchParams();
  if (q.search.trim()) p.set("search", q.search.trim());
  if (q.classId.length) p.set("classId", q.classId.join(","));
  if (q.sectionId.length) p.set("sectionId", q.sectionId.join(","));
  if (q.status.length) p.set("status", q.status.join(","));
  if (q.feeStatus.length) p.set("feeStatus", q.feeStatus.join(","));
  if (q.sort !== "name") p.set("sort", q.sort);
  if (q.dir !== "asc") p.set("dir", q.dir);
  if (q.page > 1) p.set("page", String(q.page));
  if (q.pageSize !== 25) p.set("pageSize", String(q.pageSize));
  return p.toString();
}

const SORT_LABEL: Record<SortKey, string> = {
  name: "name",
  admissionNo: "student ID",
  attendance: "attendance rate",
  class: "class",
};

function SortHeader({ label, sortKey, query, onSort }: { label: string; sortKey: SortKey; query: DirectoryQuery; onSort: (k: SortKey) => void }) {
  const active = query.sort === sortKey;
  const Icon = !active ? ArrowUpDown : query.dir === "asc" ? ArrowUp : ArrowDown;
  const next = active && query.dir === "asc" ? "descending" : "ascending";
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      aria-label={`Sort by ${SORT_LABEL[sortKey]}, ${next}${active ? `. Currently ${query.dir === "asc" ? "ascending" : "descending"}` : ""}`}
      className={cn(
        "-mx-1 inline-flex items-center gap-1 rounded px-1 uppercase tracking-[0.04em] hover:text-fg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
        active && "text-fg",
      )}
    >
      {label}
      <Icon className={cn("size-3.5", !active && "opacity-50")} aria-hidden />
    </button>
  );
}

/** Admin student directory: one server page at a time, filters and sort kept in the URL. */
export function StudentDirectory({ perms }: { perms: DirectoryPermissions }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const query = useMemo(() => readQuery(new URLSearchParams(qs)), [qs]);
  const sections = useSectionOptions();
  const recordPayment = useRecordPayment();

  const [searchText, setSearchText] = useState(query.search);
  const [open, setOpen] = useState<DirectoryRow | null>(null);
  const [action, setAction] = useState<StudentAction>(null);
  const [adding, setAdding] = useState(false);

  const apiParams = new URLSearchParams(writeQuery(query));
  apiParams.set("page", String(query.page));
  apiParams.set("pageSize", String(query.pageSize));
  const apiPath = `/students/directory?${apiParams.toString()}`;
  const directory = useKeyedApi<DirectoryPage>(apiPath);
  // Keep the last page on screen (dimmed) while the next one loads.
  const [shown, setShown] = useState<DirectoryPage | null>(null);
  if (directory.data && directory.data !== shown) setShown(directory.data);
  const fetching = directory.loading && shown !== null;

  function update(patch: Partial<DirectoryQuery>, resetPage = true) {
    const next = { ...query, ...patch, ...(resetPage && !("page" in patch) ? { page: 1 } : {}) };
    const s = writeQuery(next);
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }

  /** The last search this page wrote to the URL, so its echo does not overwrite newer typing. */
  const [pushedSearch, setPushedSearch] = useState(query.search.trim());
  // Search runs on the server; wait for a short pause in typing.
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchText.trim() !== query.search.trim()) {
        setPushedSearch(searchText.trim());
        update({ search: searchText });
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  // Back/forward changes the URL search: mirror it into the box.
  const [lastUrlSearch, setLastUrlSearch] = useState(query.search);
  if (query.search !== lastUrlSearch) {
    setLastUrlSearch(query.search);
    if (query.search.trim() !== pushedSearch && query.search.trim() !== searchText.trim()) {
      setPushedSearch(query.search.trim());
      setSearchText(query.search);
    }
  }

  // A page past the end (after a filter or a deletion elsewhere) goes back to the last page.
  const lastPage = shown ? Math.max(1, Math.ceil(shown.total / query.pageSize)) : 1;
  useEffect(() => {
    if (directory.data && query.page > lastPage) update({ page: lastPage }, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directory.data, query.page, lastPage]);

  function onSort(k: SortKey) {
    update({ sort: k, dir: query.sort === k && query.dir === "asc" ? "desc" : "asc" });
  }

  const multiCampus = new Set(sections.classes.map((c) => c.campus.name)).size > 1;
  const gradeOptions = sections.classes.map((c) => ({ value: c.id, label: c.name, hint: multiCampus ? c.campus.name : undefined }));
  const sectionOptions = sections.options
    .filter((o) => query.classId.length === 0 || query.classId.includes(o.classId))
    .map((o) => ({ value: o.value, label: o.label }));
  const filtered = query.classId.length + query.sectionId.length + query.status.length + query.feeStatus.length > 0;

  const columns: Column<DirectoryRow>[] = [
    {
      id: "admissionNo",
      header: <SortHeader label="Student ID" sortKey="admissionNo" query={query} onSort={onSort} />,
      width: "120px",
      cell: (r) => <span className="font-mono text-xs text-fg-secondary">{r.admissionNo}</span>,
      hideBelow: "md",
    },
    {
      id: "name",
      header: <SortHeader label="Student" sortKey="name" query={query} onSort={onSort} />,
      cell: (r) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={r.name} src={r.photoUrl} size="sm" />
          <div className="min-w-0">
            <Link href={`/students/${r.id}`} className="block truncate font-medium text-fg hover:text-brand">
              {r.name}
            </Link>
            <span className="flex items-center gap-1.5 text-xs text-fg-muted">
              <span className="font-mono md:hidden">{r.admissionNo}</span>
              {r.status !== "ACTIVE" && <StatusPill status={r.status} />}
            </span>
          </div>
        </div>
      ),
    },
    {
      id: "class",
      header: <SortHeader label="Grade / class" sortKey="class" query={query} onSort={onSort} />,
      cell: (r) => classLabel(r) ?? <span className="text-fg-muted">Not enrolled</span>,
      hideBelow: "sm",
    },
    {
      id: "attendance",
      header: <SortHeader label="Attendance" sortKey="attendance" query={query} onSort={onSort} />,
      width: "160px",
      cell: (r) =>
        r.attendanceRate == null ? (
          <span className="text-[13px] text-fg-muted">No data</span>
        ) : (
          <div className="flex items-center gap-2">
            <ProgressBar
              value={r.attendanceRate}
              tone={rateTone(r.attendanceRate)}
              size="sm"
              className="w-16"
            />
            <span className="w-12 text-right text-[13px] tabular-nums text-fg">{r.attendanceRate}%</span>
          </div>
        ),
      hideBelow: "md",
    },
    {
      id: "guardian",
      header: "Guardian contact",
      cell: (r) =>
        r.guardian ? (
          <div className="min-w-0">
            <span className="block truncate text-fg">
              {r.guardian.name}
              <span className="text-fg-muted"> ({r.guardian.relation})</span>
            </span>
            <a
              href={`tel:${r.guardian.phone}`}
              className="inline-flex items-center gap-1 text-xs tabular-nums text-fg-secondary hover:text-brand"
              aria-label={`Call ${r.guardian.name} on ${r.guardian.phone}`}
            >
              <Phone className="size-3" aria-hidden />
              {r.guardian.phone}
            </a>
          </div>
        ) : (
          <span className="text-fg-muted">Not added</span>
        ),
      hideBelow: "lg",
    },
    {
      id: "fees",
      header: "Fee status",
      cell: (r) =>
        r.feeStatus == null ? (
          <span className="text-[13px] text-fg-muted">Not available</span>
        ) : (
          <div className="flex flex-col items-start gap-0.5">
            <StatusPill status={r.feeStatus} />
            {r.balance != null && r.balance > 0 && <span className="text-xs tabular-nums text-fg-muted">{rupees(r.balance)} due</span>}
          </div>
        ),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      width: "52px",
      align: "right",
      cell: (r) => (
        <StudentActionsMenu
          student={r}
          perms={r.feeStatus == null ? { ...perms, fees: false } : perms}
          onAction={setAction}
          onRecordPayment={recordPayment}
        />
      ),
    },
  ];

  const addButton = perms.setup ? (
    <Button icon={<Plus />} onClick={() => setAdding(true)}>
      Add student
    </Button>
  ) : undefined;

  const headerActions = perms.setup ? (
    <>
      <Link href="/students/import" className={buttonClass("secondary")}>
        <FileSpreadsheet aria-hidden />
        Import from Excel
      </Link>
      {addButton}
    </>
  ) : undefined;

  const total = shown?.total ?? 0;
  const statusWord =
    query.status.length === 1 ? STATUS_OPTIONS.find((o) => o.value === query.status[0])?.label.toLowerCase() : query.status.length ? "" : "active";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Student directory"
        description={
          shown
            ? `${total.toLocaleString("en-PK")} ${statusWord ? `${statusWord} ` : ""}student${total === 1 ? "" : "s"}${filtered || query.search ? " match this view" : ""}.`
            : "Everyone enrolled at your school, with attendance and fee standing."
        }
        breadcrumbs={[{ label: "People" }, { label: "Student directory" }]}
        actions={headerActions}
      />

      <DataTable
        label="Student directory"
        columns={columns}
        data={shown?.items}
        loading={!shown && !directory.error}
        getRowId={(r) => r.id}
        error={shown ? "" : directory.error}
        onRetry={directory.reload}
        search={searchText}
        onSearchChange={setSearchText}
        manualFiltering
        searchPlaceholder="Search name, admission no. or phone"
        filters={
          <>
            <MultiSelectFilter
              label="Grade"
              options={gradeOptions}
              value={query.classId}
              onChange={(v) => {
                const keep = query.sectionId.filter((id) => v.length === 0 || v.includes(sections.options.find((o) => o.value === id)?.classId ?? ""));
                update({ classId: v, sectionId: keep });
              }}
              emptyText="No classes set up yet."
            />
            <MultiSelectFilter label="Section" options={sectionOptions} value={query.sectionId} onChange={(v) => update({ sectionId: v })} />
            <MultiSelectFilter label="Status" options={STATUS_OPTIONS} value={query.status} onChange={(v) => update({ status: v })} />
            <MultiSelectFilter label="Fee status" options={FEE_STATUS_OPTIONS} value={query.feeStatus} onChange={(v) => update({ feeStatus: v })} />
            {filtered && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => update({ classId: [], sectionId: [], status: [], feeStatus: [] })}
              >
                Clear filters
              </Button>
            )}
          </>
        }
        filtered={filtered}
        empty={{
          title: filtered || query.search ? "No students match" : "No students yet",
          description:
            filtered || query.search
              ? "Try a different search or clear the filters."
              : perms.setup
                ? "Add your first student, or admit one from Admissions."
                : "Students appear here once the office enrols them.",
          action: filtered || query.search ? undefined : addButton,
        }}
        serverPagination={
          shown
            ? {
                page: query.page,
                pageSize: query.pageSize,
                total,
                onPageChange: (page) => update({ page }, false),
                onPageSizeChange: (pageSize) => update({ pageSize }),
                pageSizeOptions: PAGE_SIZES,
              }
            : undefined
        }
        onRowClick={setOpen}
        getRowLabel={(r) => `${r.name}, open quick view`}
        rowClassName={() => (fetching ? "opacity-60 transition-opacity" : undefined)}
        maxHeight="70vh"
      />

      <StudentDrawer row={open} onClose={() => setOpen(null)} perms={perms} onAction={setAction} onRecordPayment={recordPayment} />

      <StudentActionDialogs action={action} onClose={() => setAction(null)} onChanged={directory.reload} />

      {perms.setup && <AddStudentDrawer open={adding} onOpenChange={setAdding} onCreated={directory.reload} />}
    </div>
  );
}
