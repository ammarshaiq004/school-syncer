"use client";

import Link from "next/link";
import { Badge, Card, ErrorText, rowClass, tableClass } from "@/components/ui";
import { day, rupees } from "@/lib/format";
import { daysOverdue, FINE_LABEL, type Loan } from "@/lib/library";
import { useApi } from "@/lib/use-api";

/** The books a student has out and has read. */
export function StudentLibrary({ studentId }: { studentId: string }) {
  const loans = useApi<Loan[]>(`/library/students/${studentId}`);
  const out = loans.data?.filter((l) => !l.returnedOn) ?? [];
  const past = loans.data?.filter((l) => l.returnedOn) ?? [];

  return (
    <Card>
      <h2 className="mb-3 font-semibold">Library</h2>
      <ErrorText>{loans.error}</ErrorText>
      {out.length === 0 ? (
        <p className="text-sm opacity-60">No books out.</p>
      ) : (
        <ul className="mb-3 space-y-1 text-sm">
          {out.map((l) => (
            <li key={l.id} className="flex flex-wrap justify-between gap-2">
              <Link className="text-brand" href={`/library/books/${l.bookId}`}>{l.title}</Link>
              <span>
                due {day(l.dueOn)} {l.overdue && <Badge tone="red">{daysOverdue(l.dueOn)} days late</Badge>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {past.length > 0 && (
        <table className={tableClass}>
          <thead className="opacity-60"><tr><th className="py-2">Read before</th><th>Returned</th><th>Fine</th></tr></thead>
          <tbody>
            {past.slice(0, 8).map((l) => (
              <tr key={l.id} className={rowClass}>
                <td className="py-2">{l.title}</td>
                <td>{l.lost ? "lost" : day(l.returnedOn!)}</td>
                <td>{l.fine ? <>{rupees(l.fine)} <span className="text-xs opacity-60">{FINE_LABEL[l.fineStatus]}</span></> : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
