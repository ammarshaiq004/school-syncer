"use client";

import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Select } from "@/components/select";
import { Badge, Button, Card, ErrorText, Field, Notice, rowClass, tableClass } from "@/components/ui";
import { api } from "@/lib/api";
import { day, fullName, rupees } from "@/lib/format";
import { useApi } from "@/lib/use-api";

interface Voucher {
  id: string;
  voucherNo: string;
  period: string;
  issueDate: string;
  dueDate: string;
  total: number;
  paid: number;
  balance: number;
  lateFine: number;
  status: string;
  school: { name: string; city: string | null; phone: string | null };
  lines: { id: string; description: string; amount: number }[];
  payments: { id: string; amount: number; method: string; receiptNo: string; reference: string | null; receivedAt: string }[];
  student: {
    firstName: string;
    lastName: string | null;
    admissionNo: string;
    enrollments: { section: { name: string; class: { name: string } } }[];
    guardians: { guardian: { name: string } }[];
  };
}

const METHODS = ["CASH", "BANK", "JAZZCASH", "EASYPAISA", "ONEBILL", "CARD"];

export default function VoucherPage() {
  const { id } = useParams<{ id: string }>();
  const voucher = useApi<Voucher>(`/fees/invoices/${id}`);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const v = voucher.data;

  async function pay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const f = new FormData(formEl);
    try {
      const res = await api<{ payment: { receiptNo: string } }>(`/fees/invoices/${id}/payments`, {
        method: "POST",
        body: { amount: Number(f.get("amount")), method: f.get("method"), reference: f.get("reference") || undefined },
      });
      setNotice(`Payment recorded. Receipt ${res.payment.receiptNo}.`);
      setError("");
      formEl.reset();
      await voucher.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!v) return <ErrorText>{voucher.error}</ErrorText>;
  const cls = v.student.enrollments[0];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="text-2xl font-semibold">Voucher {v.voucherNo}</h1>
        <div className="flex items-center gap-2">
          <Badge tone={v.status === "PAID" ? "green" : v.status === "PARTIAL" ? "amber" : "red"}>{v.status.toLowerCase()}</Badge>
          <Button variant="ghost" onClick={() => window.print()}>Print voucher</Button>
        </div>
      </div>
      <Notice>{notice}</Notice>
      <ErrorText>{error}</ErrorText>

      {/* Three copies on one A4 page: bank, school and parent. */}
      <div className="grid gap-4 md:grid-cols-3 print:grid-cols-3 print:gap-2 print:text-[11px]">
        {["Bank copy", "School copy", "Parent copy"].map((copy) => (
          <div key={copy} className="rounded-xl border border-dashed border-black/30 bg-white p-4 text-black dark:border-white/30">
            <div className="flex justify-between text-xs uppercase tracking-wide opacity-60"><span>{copy}</span><span>{v.voucherNo}</span></div>
            <div className="mt-1 text-lg font-bold">{v.school.name}</div>
            <div className="text-xs opacity-70">{[v.school.city, v.school.phone].filter(Boolean).join(" · ")}</div>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 text-sm">
              <dt className="opacity-60">Student</dt><dd className="font-medium">{fullName(v.student)}</dd>
              <dt className="opacity-60">Adm. no.</dt><dd>{v.student.admissionNo}</dd>
              <dt className="opacity-60">Class</dt><dd>{cls ? `${cls.section.class.name} ${cls.section.name}` : "–"}</dd>
              <dt className="opacity-60">Guardian</dt><dd>{v.student.guardians[0]?.guardian.name ?? "–"}</dd>
              <dt className="opacity-60">Month</dt><dd>{v.period}</dd>
              <dt className="opacity-60">Due date</dt><dd className="font-medium">{day(v.dueDate)}</dd>
            </dl>
            <table className="mt-3 w-full text-sm">
              <tbody>
                {v.lines.map((l) => (
                  <tr key={l.id}><td>{l.description}</td><td className="text-right">{rupees(l.amount)}</td></tr>
                ))}
                <tr className="border-t border-black/20 font-bold"><td className="pt-1">Total</td><td className="pt-1 text-right">{rupees(v.total)}</td></tr>
                {v.paid > 0 && <tr><td>Paid</td><td className="text-right">{rupees(v.paid)}</td></tr>}
                {v.lateFine > 0 && <tr><td>Late fine so far</td><td className="text-right">{rupees(v.lateFine)}</td></tr>}
              </tbody>
            </table>
            <div className="mt-3 text-xs opacity-60">Pay at the school counter, by bank, or with JazzCash / Easypaisa using voucher no. {v.voucherNo}.</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2 print:hidden">
        <Card>
          <h2 className="mb-3 font-semibold">Payments</h2>
          <table className={tableClass}>
            <thead className="opacity-60"><tr><th className="py-2">Date</th><th>Amount</th><th>Method</th><th>Receipt</th></tr></thead>
            <tbody>
              {v.payments.map((p) => (
                <tr key={p.id} className={rowClass}>
                  <td className="py-2">{day(p.receivedAt)}</td>
                  <td>{rupees(p.amount)}</td>
                  <td>{p.method.toLowerCase()}{p.reference ? ` · ${p.reference}` : ""}</td>
                  <td className="font-mono text-xs">{p.receiptNo}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {v.payments.length === 0 && <p className="text-sm opacity-60">No payments yet.</p>}
        </Card>
        {v.status !== "PAID" && v.status !== "CANCELLED" && (
          <Card>
            <h2 className="mb-3 font-semibold">Record a payment</h2>
            <form onSubmit={pay} className="grid gap-3 sm:grid-cols-2">
              <Field label="Amount (Rs)" name="amount" type="number" min={1} defaultValue={v.balance} required />
              <Select label="Method" name="method" options={METHODS.map((m) => ({ value: m, label: m.toLowerCase() }))} />
              <Field label="Reference (bank or wallet transaction id)" name="reference" />
              <div className="flex items-end"><Button type="submit">Save payment</Button></div>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
