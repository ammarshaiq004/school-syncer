"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Button, ErrorText } from "@/components/ui";
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

const monthName = (period: string) =>
  new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export default function PayslipPage() {
  const { id } = useParams<{ id: string }>();
  const slip = useApi<Payslip>(`/hr/payslips/${id}`);
  if (slip.error) return <ErrorText>{slip.error}</ErrorText>;
  const s = slip.data;
  if (!s) return <p className="text-sm opacity-60">Loading...</p>;
  const earnings = s.lines.filter((l) => l.type === "ALLOWANCE");
  const deductions = s.lines.filter((l) => l.type === "DEDUCTION");
  const total = (ls: typeof earnings) => ls.reduce((sum, l) => sum + l.amount, 0);
  const cell = "border border-black/20 px-3 py-1.5";
  const p = s.user.staffProfile;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between print:hidden">
        <Link href="/hr" className="text-sm text-brand">Back to HR</Link>
        <Button variant="ghost" onClick={() => window.print()}>Print payslip</Button>
      </div>
      <article className="mx-auto w-full max-w-2xl rounded-xl border border-black/10 bg-white p-8 text-sm text-black shadow-sm print:border-0 print:p-0 print:shadow-none">
        <header className="mb-6 text-center">
          <h1 className="text-2xl font-bold">{s.run.school.name}</h1>
          <p className="text-base font-medium">Payslip for {monthName(s.run.period)}</p>
          {s.run.status !== "FINALIZED" && <p className="font-semibold text-amber-700">Draft, not final</p>}
        </header>
        <dl className="mb-6 grid grid-cols-2 gap-x-6 gap-y-1">
          <div className="flex gap-2"><dt className="opacity-60">Name</dt><dd className="font-semibold">{s.user.name}</dd></div>
          <div className="flex gap-2"><dt className="opacity-60">Employee no.</dt><dd>{p?.employeeNo}</dd></div>
          <div className="flex gap-2"><dt className="opacity-60">Designation</dt><dd>{p?.designation}</dd></div>
          <div className="flex gap-2"><dt className="opacity-60">Department</dt><dd>{p?.department ?? "–"}</dd></div>
          <div className="flex gap-2"><dt className="opacity-60">Working days</dt><dd>{s.workingDays}</dd></div>
          <div className="flex gap-2"><dt className="opacity-60">Unpaid days</dt><dd>{s.unpaidDays}</dd></div>
        </dl>
        <div className="mb-6 grid grid-cols-2 gap-4">
          {[["Earnings", earnings], ["Deductions", deductions]].map(([title, lines]) => (
            <table key={title as string} className="w-full border-collapse self-start">
              <thead className="bg-black/5"><tr><th className={`${cell} text-left`} colSpan={2}>{title as string}</th></tr></thead>
              <tbody>
                {(lines as typeof earnings).map((l) => (
                  <tr key={l.name}><td className={cell}>{l.name}</td><td className={`${cell} text-right`}>{rupees(l.amount)}</td></tr>
                ))}
                {!(lines as typeof earnings).length && <tr><td className={cell} colSpan={2}>None</td></tr>}
                <tr className="font-semibold"><td className={cell}>Total</td><td className={`${cell} text-right`}>{rupees(total(lines as typeof earnings))}</td></tr>
              </tbody>
            </table>
          ))}
        </div>
        <div className="mb-6 rounded-lg border border-black/20 p-4 text-center">
          <div className="text-xs opacity-60">Net pay</div>
          <div className="text-2xl font-bold">{rupees(s.net)}</div>
        </div>
        <footer className="flex items-end justify-between text-xs">
          <p className="opacity-70">
            {s.paidAt ? `Paid ${day(s.paidAt)} by ${s.paymentMethod?.toLowerCase()}` : "Not paid yet"}
            {p?.bankAccount ? ` · ${p.bankName ?? "Bank"} ${p.bankAccount}` : ""}
          </p>
          <div className="w-36 border-t border-black/40 pt-1 text-center">Authorised signature</div>
        </footer>
      </article>
    </div>
  );
}
