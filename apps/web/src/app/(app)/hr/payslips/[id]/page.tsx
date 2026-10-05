"use client";

import { useParams } from "next/navigation";
import { Printer } from "lucide-react";
import { Button, ErrorState, PageHeader, Skeleton, StatusPill } from "@/components/ui";
import { day, rupees } from "@/lib/format";
import { useApi } from "@/lib/use-api";

interface Payslip {
  net: number;
  unpaidDays: number;
  workingDays: number;
  paidAt: string | null;
  paymentMethod: string | null;
  lines: { name: string; type: "ALLOWANCE" | "DEDUCTION"; amount: number }[];
  user: {
    name: string;
    staffProfile: { employeeNo: string; designation: string; department: string | null; bankName: string | null; bankAccount: string | null } | null;
  };
  run: { period: string; status: string; school: { name: string } };
}

type Line = Payslip["lines"][number];

const monthName = (period: string) =>
  new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

const crumbs = (label: string) => [{ label: "HR and payroll", href: "/hr" }, { label }];

export default function PayslipPage() {
  const { id } = useParams<{ id: string }>();
  const slip = useApi<Payslip>(`/hr/payslips/${id}`);

  if (slip.error)
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Payslip" breadcrumbs={crumbs("Payslip")} />
        <ErrorState message={slip.error} onRetry={slip.reload} />
      </div>
    );
  const s = slip.data;
  if (!s)
    return (
      <div className="flex flex-col gap-6" aria-busy>
        <PageHeader title="Payslip" breadcrumbs={crumbs("Payslip")} />
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 rounded-xl border border-border bg-surface p-8">
          <Skeleton className="mx-auto h-7 w-56" />
          <Skeleton className="mx-auto h-4 w-40" />
          <Skeleton className="mt-4 h-24 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );

  const earnings = s.lines.filter((l) => l.type === "ALLOWANCE");
  const deductions = s.lines.filter((l) => l.type === "DEDUCTION");
  const total = (ls: Line[]) => ls.reduce((sum, l) => sum + l.amount, 0);
  const cell = "border border-black/15 px-3 py-1.5";
  const p = s.user.staffProfile;
  const finalised = s.run.status === "FINALIZED";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Payslip, ${monthName(s.run.period)}`}
        description={s.user.name}
        breadcrumbs={crumbs(`${s.user.name}, ${s.run.period}`)}
        meta={
          <>
            {finalised ? <StatusPill status="COMPLETED" label="Finalised" /> : <StatusPill status="PENDING" label="Draft" />}
            {s.paidAt ? <StatusPill status="PAID" label={`Paid ${day(s.paidAt)}`} /> : <StatusPill status="UNPAID" label="Not paid yet" />}
          </>
        }
        actions={<Button type="button" variant="secondary" icon={<Printer />} onClick={() => window.print()}>Print payslip</Button>}
      />

      {/* Printed document: always black on white, like the paper copy. */}
      <article className="mx-auto w-full max-w-2xl rounded-xl border border-border bg-white p-6 text-sm text-slate-900 shadow-card sm:p-8 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <header className="mb-6 border-b border-black/10 pb-5 text-center">
          <h2 className="font-display text-2xl font-semibold">{s.run.school.name}</h2>
          <p className="mt-1 text-base font-medium">Payslip for {monthName(s.run.period)}</p>
          {!finalised && <p className="mt-1 font-semibold text-amber-700">Draft, not final</p>}
        </header>
        <dl className="mb-6 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2 print:grid-cols-2">
          {[
            ["Name", <span key="n" className="font-semibold">{s.user.name}</span>],
            ["Employee no.", p?.employeeNo],
            ["Designation", p?.designation],
            ["Department", p?.department ?? "–"],
            ["Working days", s.workingDays],
            ["Unpaid days", s.unpaidDays],
          ].map(([label, value]) => (
            <div key={label as string} className="flex gap-2">
              <dt className="text-slate-500">{label}</dt>
              <dd className="tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 print:grid-cols-2">
          {([["Earnings", earnings], ["Deductions", deductions]] as [string, Line[]][]).map(([title, lines]) => (
            <table key={title} className="w-full self-start border-collapse">
              <thead className="bg-slate-100"><tr><th className={`${cell} text-left font-semibold`} colSpan={2}>{title}</th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.name}><td className={cell}>{l.name}</td><td className={`${cell} text-right tabular-nums`}>{rupees(l.amount)}</td></tr>
                ))}
                {!lines.length && <tr><td className={`${cell} text-slate-500`} colSpan={2}>None</td></tr>}
                <tr className="font-semibold"><td className={cell}>Total</td><td className={`${cell} text-right tabular-nums`}>{rupees(total(lines))}</td></tr>
              </tbody>
            </table>
          ))}
        </div>
        <div className="mb-6 rounded-lg border border-black/15 bg-slate-50 p-4 text-center print:bg-transparent">
          <div className="text-xs font-medium uppercase tracking-[0.04em] text-slate-500">Net pay</div>
          <div className="mt-1 font-display text-2xl font-semibold tabular-nums">{rupees(s.net)}</div>
        </div>
        <footer className="flex flex-wrap items-end justify-between gap-4 text-xs">
          <p className="text-slate-600">
            {s.paidAt ? `Paid ${day(s.paidAt)} by ${s.paymentMethod?.toLowerCase()}` : "Not paid yet"}
            {p?.bankAccount ? `, ${p.bankName ?? "Bank"} ${p.bankAccount}` : ""}
          </p>
          <div className="w-36 border-t border-black/40 pt-1 text-center">Authorised signature</div>
        </footer>
      </article>
    </div>
  );
}
