"use client";

import Link from "next/link";
import { BookOpen } from "lucide-react";
import { Card, CardHeader, DataTable, EmptyState, ErrorState, SkeletonRows, StatusPill, type Column } from "@/components/ui";
import { day, rupees } from "@/lib/format";
import { daysOverdue, FINE_LABEL, type Loan } from "@/lib/library";
import { useApi } from "@/lib/use-api";

const pastColumns: Column<Loan>[] = [
  { id: "title", header: "Read before", cell: (l) => <Link className="hover:text-brand hover:underline" href={`/library/books/${l.bookId}`}>{l.title}</Link> },
  { id: "returned", header: "Returned", cell: (l) => (l.lost ? <StatusPill status="LOST" /> : day(l.returnedOn!)) },
  {
    id: "fine",
    header: "Fine",
    align: "right",
    cell: (l) =>
      l.fine ? (
        <span className="block">
          {rupees(l.fine)}
          <span className="block text-xs text-fg-muted">{FINE_LABEL[l.fineStatus]}</span>
        </span>
      ) : "–",
  },
];

/** The books a student has out and has read. */
export function StudentLibrary({ studentId }: { studentId: string }) {
  const loans = useApi<Loan[]>(`/library/students/${studentId}`);
  const out = loans.data?.filter((l) => !l.returnedOn) ?? [];
  const past = loans.data?.filter((l) => l.returnedOn) ?? [];

  return (
    <Card>
      <CardHeader title="Library" icon={<BookOpen />} description={loans.data ? `${out.length} out now, ${past.length} read before` : undefined} />
      {loans.error ? (
        <ErrorState compact message={loans.error} onRetry={loans.reload} />
      ) : !loans.data ? (
        <SkeletonRows rows={3} columns={2} />
      ) : (
        <div className="flex flex-col gap-4">
          {out.length === 0 ? (
            <EmptyState compact icon={<BookOpen />} title="No books out" />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {out.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <Link className="font-medium text-brand hover:underline" href={`/library/books/${l.bookId}`}>{l.title}</Link>
                  <span className="flex items-center gap-2 text-[13px] text-fg-muted">
                    Due {day(l.dueOn)}
                    {l.overdue ? <StatusPill status="OVERDUE" label={`${daysOverdue(l.dueOn)} days late`} /> : <StatusPill status="ISSUED" label="On loan" tone="info" />}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {past.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-border">
              <DataTable bare dense label="Books read before" columns={pastColumns} data={past.slice(0, 8)} getRowId={(l) => l.id} pageSize={0} />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
