"use client";

import Link from "next/link";
import { Badge, Card, ErrorText, PageTitle } from "@/components/ui";
import { day, rupees } from "@/lib/format";
import { useApi } from "@/lib/use-api";

interface Child {
  id: string;
  name: string;
  relation: string;
  admissionNo: string;
  class: string | null;
  attendanceThisMonth: { present: number; absent: number; leave: number; absentDates: string[] };
  homework: { id: string; subject: string; title: string; details: string | null; dueDate: string }[];
  results: { examId: string; exam: string; percent: number; grade: string; position: number; passed: boolean }[];
  unpaidInvoices: { id: string; voucherNo: string; period: string; dueDate: string; balance: number }[];
  transport: {
    route: string;
    stop: string | null;
    pickupTime: string | null;
    dropTime: string | null;
    vehicle: string | null;
    driverName: string | null;
    driverPhone: string | null;
  } | null;
}

export default function ParentPage() {
  const children = useApi<Child[]>("/parent/children");
  return (
    <div className="flex flex-col gap-6">
      <PageTitle>My children</PageTitle>
      <ErrorText>{children.error}</ErrorText>
      {children.data?.length === 0 && <p className="text-sm opacity-70">No children are linked to your number yet. Please contact the school office.</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        {children.data?.map((c) => (
          <Card key={c.id}>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">{c.name}</h2>
                <div className="text-sm opacity-70">{c.class ?? "Not enrolled"} · {c.admissionNo}</div>
              </div>
              {c.unpaidInvoices.length ? <Badge tone="red">fees due</Badge> : <Badge tone="green">fees clear</Badge>}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg bg-black/5 p-3 dark:bg-white/10"><div className="text-2xl font-semibold">{c.attendanceThisMonth.present}</div><div className="text-xs opacity-60">present this month</div></div>
              <div className="rounded-lg bg-black/5 p-3 dark:bg-white/10"><div className="text-2xl font-semibold">{c.attendanceThisMonth.absent}</div><div className="text-xs opacity-60">absent</div></div>
              <div className="rounded-lg bg-black/5 p-3 dark:bg-white/10"><div className="text-2xl font-semibold">{c.attendanceThisMonth.leave}</div><div className="text-xs opacity-60">leave</div></div>
            </div>
            {c.attendanceThisMonth.absentDates.length > 0 && (
              <p className="mt-2 text-xs opacity-70">Absent on {c.attendanceThisMonth.absentDates.map((d) => day(d)).join(", ")}</p>
            )}
            {c.homework.length > 0 && (
              <div className="mt-4">
                <h3 className="mb-1 text-sm font-semibold">Homework</h3>
                <ul className="flex flex-col gap-1 text-sm">
                  {c.homework.map((h) => (
                    <li key={h.id}>
                      <span className="font-medium">{h.subject}:</span> {h.title}
                      <span className="opacity-60"> · due {day(h.dueDate)}</span>
                      {h.details && <div className="text-xs opacity-70">{h.details}</div>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {c.class && (
              <Link href={`/parent/timetable/${c.id}`} className="mt-4 inline-block text-sm text-brand hover:underline">View timetable</Link>
            )}
            {c.results.length > 0 && (
              <div className="mt-4">
                <h3 className="mb-1 text-sm font-semibold">Results</h3>
                <ul className="text-sm">
                  {c.results.map((r) => (
                    <li key={r.examId} className="flex justify-between gap-3">
                      <Link href={`/parent/results/${r.examId}/${c.id}`} className="text-brand hover:underline">{r.exam}</Link>
                      <span>{r.percent}% · grade {r.grade} · position {r.position}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {c.transport && (
              <div className="mt-4">
                <h3 className="mb-1 text-sm font-semibold">School van</h3>
                <p className="text-sm">
                  {c.transport.route}
                  {c.transport.stop && <> · {c.transport.stop}</>}
                  {c.transport.pickupTime && <> · picked up {c.transport.pickupTime}</>}
                  {c.transport.dropTime && <>, dropped {c.transport.dropTime}</>}
                </p>
                {c.transport.driverName && (
                  <p className="text-sm opacity-70">
                    {c.transport.vehicle} · driver {c.transport.driverName},{" "}
                    <a className="text-brand" href={`tel:${c.transport.driverPhone}`}>{c.transport.driverPhone}</a>
                  </p>
                )}
              </div>
            )}
            {c.unpaidInvoices.length > 0 && (
              <div className="mt-4">
                <h3 className="mb-1 text-sm font-semibold">Unpaid fees</h3>
                <ul className="text-sm">
                  {c.unpaidInvoices.map((i) => (
                    <li key={i.id} className="flex justify-between">
                      <span>{i.period} · voucher {i.voucherNo} · due {day(i.dueDate)}</span>
                      <strong>{rupees(i.balance)}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
