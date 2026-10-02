"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Card, ErrorText, Notice, PageTitle, rowClass, tableClass } from "@/components/ui";
import { platformApi } from "@/lib/api";
import { day, rupees, thisMonth } from "@/lib/format";
import { usePlatformApi } from "@/lib/use-api";
import { monthName, StatusBadge } from "../status";

interface Bill {
  id: string;
  number: string;
  period: string;
  planName: string;
  students: number;
  amount: number;
  status: string;
  dueDate: string;
  paidAt: string | null;
  method: string | null;
  reference: string | null;
  school: { id: string; name: string };
}

const METHODS = ["Bank transfer", "JazzCash", "Easypaisa", "Cheque", "Cash"];
const inputClass = "rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20";

export default function BillsPage() {
  // Links from the overview pass ?status=... (the console only renders in the browser).
  const [status, setStatus] = useState(() => new URLSearchParams(window.location.search).get("status") ?? "");
  const bills = usePlatformApi<Bill[]>(`/invoices${status ? `?status=${status}` : ""}`);
  const [period, setPeriod] = useState(thisMonth());
  const [paying, setPaying] = useState<Bill | null>(null);
  const [method, setMethod] = useState(METHODS[0]);
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function run(action: () => Promise<string>) {
    setError("");
    setNotice("");
    try {
      setNotice(await action());
      await bills.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const generate = () =>
    run(async () => {
      const res = await platformApi<{ created: number; total: number }>("/invoices/generate", { method: "POST", body: { period } });
      return res.created
        ? `Billed ${res.created} ${res.created === 1 ? "school" : "schools"} ${rupees(res.total)} for ${monthName(period)}.`
        : `Every paying school already has a bill for ${monthName(period)}.`;
    });

  const pay = () =>
    run(async () => {
      if (!paying) return "";
      await platformApi(`/invoices/${paying.id}/pay`, { method: "POST", body: { method, reference: reference || undefined } });
      setPaying(null);
      setReference("");
      return `${paying.number} from ${paying.school.name} marked paid.`;
    });

  const voidBill = (b: Bill) =>
    confirm(`Void ${b.number} for ${b.school.name}? The school will no longer owe it.`) &&
    run(async () => {
      await platformApi(`/invoices/${b.id}/void`, { method: "POST" });
      return `${b.number} voided.`;
    });

  const unpaidTotal = bills.data?.filter((b) => b.status === "UNPAID").reduce((a, b) => a + b.amount, 0) ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <PageTitle>Bills</PageTitle>
      <Card>
        <h2 className="mb-2 font-semibold">Bill paying schools for a month</h2>
        <p className="mb-3 text-sm opacity-70">
          Each active or past-due school is billed at its current number of active students. Schools on trial are skipped,
          and running it twice for the same month does nothing.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className={inputClass} aria-label="Month" />
          <Button onClick={generate}>Create bills</Button>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass} aria-label="Status">
          <option value="">All bills</option>
          <option value="UNPAID">Unpaid</option>
          <option value="PAID">Paid</option>
          <option value="VOID">Void</option>
        </select>
        {unpaidTotal > 0 && <span className="text-sm">Unpaid shown: <b>{rupees(unpaidTotal)}</b></span>}
      </div>
      <ErrorText>{error || bills.error}</ErrorText>
      <Notice>{notice}</Notice>

      {paying && (
        <Card>
          <h2 className="mb-3 font-semibold">Record payment for {paying.number} ({paying.school.name}, {rupees(paying.amount)})</h2>
          <div className="flex flex-wrap items-end gap-3">
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass} aria-label="Method">
              {METHODS.map((m) => <option key={m}>{m}</option>)}
            </select>
            <input placeholder="Reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} className={inputClass} />
            <Button onClick={pay}>Mark paid</Button>
            <Button variant="ghost" onClick={() => setPaying(null)}>Cancel</Button>
          </div>
        </Card>
      )}

      <Card className="overflow-x-auto">
        <table className={tableClass}>
          <thead className="opacity-60">
            <tr><th className="py-2">Bill</th><th>School</th><th>Month</th><th>Plan</th><th>Students</th><th>Amount</th><th>Due</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {bills.data?.map((b) => (
              <tr key={b.id} className={rowClass}>
                <td className="py-2 font-mono text-xs">{b.number}</td>
                <td><Link href={`/platform/schools/${b.school.id}`} className="text-brand hover:underline">{b.school.name}</Link></td>
                <td>{monthName(b.period)}</td>
                <td>{b.planName}</td>
                <td>{b.students}</td>
                <td>{rupees(b.amount)}</td>
                <td>{day(b.dueDate)}</td>
                <td>
                  <StatusBadge status={b.status} />
                  {b.paidAt && <div className="text-xs opacity-60">{day(b.paidAt)}, {b.method}</div>}
                </td>
                <td className="whitespace-nowrap text-right">
                  {b.status === "UNPAID" && (
                    <>
                      <button className="text-brand" onClick={() => setPaying(b)}>Mark paid</button>
                      <button className="ml-3 opacity-60 hover:opacity-100" onClick={() => voidBill(b)}>Void</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {bills.data?.length === 0 && <p className="py-4 text-sm opacity-60">No bills.</p>}
      </Card>
    </div>
  );
}
