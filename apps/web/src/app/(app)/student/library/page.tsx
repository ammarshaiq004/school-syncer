"use client";

import { BookMarked, BookOpen, CircleAlert, Library, Wallet } from "lucide-react";
import type { StudentLibraryData } from "@/components/student/types";
import { Card, DataTable, EmptyState, ErrorState, KpiCard, PageHeader, StatGrid, StatusPill, type Column } from "@/components/ui";
import { day, rupees } from "@/lib/format";
import { useSchoolMode } from "@/lib/session";
import { useApi } from "@/lib/use-api";

type Loan = StudentLibraryData["loans"][number];

const loanStatus = (l: Loan) =>
  l.lost
    ? { status: "LOST", label: "Lost" }
    : l.returnedOn
      ? { status: "RETURNED", label: "Returned" }
      : l.overdue
        ? { status: "OVERDUE", label: "Overdue" }
        : { status: "ISSUED", label: "With you" };

const columns: Column<Loan>[] = [
  {
    id: "title",
    header: "Book",
    sortValue: (l) => l.title,
    cell: (l) => (
      <div className="min-w-0">
        <div className="font-medium text-fg">{l.title}</div>
        <div className="text-xs text-fg-muted">
          {l.author ?? "Unknown author"}. Copy <span className="font-mono">{l.accessionNo}</span>
        </div>
      </div>
    ),
  },
  { id: "issued", header: "Issued", hideBelow: "md", sortValue: (l) => l.issuedOn, cell: (l) => day(l.issuedOn) },
  {
    id: "due",
    header: "Due back",
    sortValue: (l) => l.dueOn,
    cell: (l) => <span className={l.overdue ? "font-medium text-danger-text" : undefined}>{day(l.dueOn)}</span>,
  },
  { id: "returned", header: "Returned", hideBelow: "sm", cell: (l) => (l.returnedOn ? day(l.returnedOn) : "–") },
  { id: "fine", header: "Fine", align: "right", hideBelow: "sm", sortValue: (l) => l.fine, cell: (l) => (l.fine ? rupees(l.fine) : "–") },
  {
    id: "status",
    header: "Status",
    cell: (l) => {
      const s = loanStatus(l);
      return <StatusPill status={s.status} label={s.label} />;
    },
  },
];

export default function StudentLibraryPage() {
  const mode = useSchoolMode();
  const online = mode === "ONLINE";
  const library = useApi<StudentLibraryData>(online ? null : "/student/library");
  const d = library.data;
  const out = d?.loans.filter((l) => !l.returnedOn && !l.lost) ?? [];
  const overdue = out.filter((l) => l.overdue);

  const header = (
    <PageHeader title="Library" description="Books you have borrowed from the school library and when they are due back." breadcrumbs={[{ label: "Learning" }, { label: "Library" }]} />
  );

  if (online || (d && !d.available)) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Card padding="none">
          <EmptyState icon={<Library />} title="No library desk at your school" description="Your school does not lend books through SchoolSyncer. Reading material is shared in your courses." />
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {header}
      {library.error && !d ? (
        <ErrorState message={library.error} onRetry={library.reload} />
      ) : (
        <>
          <StatGrid cols={3}>
            <KpiCard label="Books with you" icon={<BookOpen />} loading={!d} value={out.length} />
            <KpiCard
              label="Overdue"
              icon={<CircleAlert />}
              tone={overdue.length ? "danger" : "success"}
              loading={!d}
              value={overdue.length}
              hint={overdue.length ? "Return these to the library desk" : "Nothing late"}
            />
            <KpiCard label="Fines due" icon={<Wallet />} tone={d?.finesDue ? "warning" : "neutral"} loading={!d} value={d ? rupees(d.finesDue) : "–"} />
          </StatGrid>
          <DataTable
            label="My library books"
            columns={columns}
            data={d?.loans ?? null}
            getRowId={(l) => l.id}
            getSearchText={(l) => `${l.title} ${l.author ?? ""} ${l.accessionNo}`}
            searchPlaceholder="Search books"
            rowClassName={(l) => (l.overdue ? "bg-danger-tint/40" : undefined)}
            empty={{ icon: <BookMarked />, title: "No books borrowed yet", description: "Books you take from the library desk show here with their due dates." }}
          />
        </>
      )}
    </div>
  );
}
