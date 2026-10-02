"use client";

import Link from "next/link";
import { Card, ErrorText, PageTitle, rowClass, tableClass } from "@/components/ui";
import { day, rupees } from "@/lib/format";
import { usePlatformApi } from "@/lib/use-api";
import { monthName, StatusBadge, STATUSES } from "./status";

interface Overview {
  schools: number;
  byStatus: Record<string, number>;
  students: number;
  mrr: number;
  unpaid: { amount: number; count: number };
  trialsEnding: { schoolId: string; name: string; trialEndsAt: string; expired: boolean }[];
  signups: { month: string; count: number }[];
}

function Stat({ label, value, href }: { label: string; value: string; href?: string }) {
  const body = (
    <Card className="h-full">
      <div className="text-sm opacity-60">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default function OverviewPage() {
  const { data, error } = usePlatformApi<Overview>("/overview");
  const peak = Math.max(1, ...(data?.signups.map((s) => s.count) ?? []));

  return (
    <div className="flex flex-col gap-6">
      <PageTitle>Overview</PageTitle>
      <ErrorText>{error}</ErrorText>
      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Monthly recurring revenue" value={rupees(data.mrr)} />
            <Stat label="Schools" value={data.schools.toLocaleString("en-PK")} href="/platform/schools" />
            <Stat label="Students on SchoolSyncer" value={data.students.toLocaleString("en-PK")} />
            <Stat
              label={`Unpaid (${data.unpaid.count} ${data.unpaid.count === 1 ? "bill" : "bills"})`}
              value={rupees(data.unpaid.amount)}
              href="/platform/invoices?status=UNPAID"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <h2 className="mb-3 font-semibold">Schools by status</h2>
              <ul className="space-y-2">
                {STATUSES.map((s) => (
                  <li key={s} className="flex items-center justify-between text-sm">
                    <Link href={`/platform/schools?status=${s}`} className="hover:underline">
                      <StatusBadge status={s} />
                    </Link>
                    <span className="font-medium">{data.byStatus[s] ?? 0}</span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card>
              <h2 className="mb-3 font-semibold">Sign-ups, last six months</h2>
              {data.signups.length === 0 ? (
                <p className="text-sm opacity-60">No new schools.</p>
              ) : (
                <div className="flex h-32 items-end gap-3">
                  {data.signups.map((s) => (
                    <div key={s.month} className="flex flex-1 flex-col items-center gap-1 text-xs">
                      <span className="font-medium">{s.count}</span>
                      <div className="w-full rounded-t bg-brand" style={{ height: `${(s.count / peak) * 80}px` }} />
                      <span className="opacity-60">{monthName(s.month)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <Card>
            <h2 className="mb-3 font-semibold">Trials ending this week or already ended</h2>
            {data.trialsEnding.length === 0 ? (
              <p className="text-sm opacity-60">None.</p>
            ) : (
              <table className={tableClass}>
                <thead className="opacity-60">
                  <tr><th className="py-2">School</th><th>Trial ends</th><th /></tr>
                </thead>
                <tbody>
                  {data.trialsEnding.map((t) => (
                    <tr key={t.schoolId} className={rowClass}>
                      <td className="py-2">
                        <Link href={`/platform/schools/${t.schoolId}`} className="font-medium text-brand hover:underline">{t.name}</Link>
                      </td>
                      <td>{day(t.trialEndsAt)}</td>
                      <td>{t.expired && <span className="text-xs text-amber-700 dark:text-amber-300">Ended, now read-only</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
