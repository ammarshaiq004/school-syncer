"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Select } from "@/components/select";
import { Badge, Button, Card, ErrorText, Field, Notice, PageTitle, rowClass, tableClass } from "@/components/ui";
import { api } from "@/lib/api";
import { day, fullName, rupees, thisMonth } from "@/lib/format";
import { useApi } from "@/lib/use-api";

interface Invoice {
  id: string;
  voucherNo: string;
  period: string;
  dueDate: string;
  total: number;
  paid: number;
  status: string;
  student: { id: string; firstName: string; lastName: string | null; admissionNo: string };
}
interface Defaulter {
  invoiceId: string;
  voucherNo: string;
  period: string;
  balance: number;
  lateFine: number;
  daysOverdue: number;
  student: { id: string; firstName: string; lastName: string | null; admissionNo: string; guardians: { guardian: { name: string; phone: string } }[] };
}
interface FeeHead { id: string; name: string; frequency: string }
interface Structure { classId: string; feeHeadId: string; amount: number }
interface SchoolClass { id: string; name: string; campus: { name: string } }
interface Year { id: string; name: string; isCurrent: boolean }

const TABS = ["Invoices", "Defaulters", "Fee setup"] as const;
const tone = (s: string) => (s === "PAID" ? "green" : s === "PARTIAL" ? "amber" : s === "UNPAID" ? "red" : "gray");

export default function FeesPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Invoices");
  return (
    <div className="flex flex-col gap-6">
      <PageTitle>Fees</PageTitle>
      <div className="flex gap-2 border-b border-black/10 dark:border-white/10">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t ? "border-brand font-medium text-brand" : "border-transparent opacity-70"}`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Invoices" && <InvoicesTab />}
      {tab === "Defaulters" && <DefaultersTab />}
      {tab === "Fee setup" && <SetupTab />}
    </div>
  );
}

function InvoicesTab() {
  const [period, setPeriod] = useState(thisMonth());
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const query = new URLSearchParams({ period, ...(status && { status }), ...(search && { search }) }).toString();
  const invoices = useApi<Invoice[]>(`/fees/invoices?${query}`);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function generate(sendWhatsApp: boolean) {
    setBusy(true);
    try {
      const res = await api<{ created: number; skipped: number; totalBilled: number; messages: number }>(
        "/fees/invoices/generate",
        { method: "POST", body: { period, sendWhatsApp } },
      );
      setNotice(
        `Created ${res.created} vouchers totalling ${rupees(res.totalBilled)}.` +
          (res.messages ? ` ${res.messages} sent on WhatsApp.` : "") +
          (res.created === 0 ? " Everyone already has a voucher for this month, or no fee structure is set." : ""),
      );
      setError("");
      await invoices.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const rows = invoices.data ?? [];
  const billed = rows.reduce((s, i) => s + i.total, 0);
  const collected = rows.reduce((s, i) => s + i.paid, 0);

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Month</span>
            <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-lg border border-black/15 bg-transparent px-3 py-2 dark:border-white/20" />
          </label>
          <Button onClick={() => generate(false)} disabled={busy}>Generate vouchers</Button>
          <Button variant="ghost" onClick={() => generate(true)} disabled={busy}>Generate and send on WhatsApp</Button>
        </div>
        <p className="mt-3 text-xs opacity-60">
          Bills every active student for the month using the fee setup. Students who already have a voucher for the month are skipped, so it is safe to run again.
        </p>
      </Card>
      <Notice>{notice}</Notice>
      <ErrorText>{error || invoices.error}</ErrorText>
      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input placeholder="Search name, admission or voucher no." value={search} onChange={(e) => setSearch(e.target.value)} className="min-w-64 flex-1 rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20" />
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20">
            <option value="">All statuses</option>
            {["UNPAID", "PARTIAL", "PAID"].map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
          </select>
          <span className="text-sm opacity-70">{rows.length} vouchers · billed {rupees(billed)} · collected {rupees(collected)}</span>
        </div>
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <thead className="opacity-60">
              <tr><th className="py-2">Voucher</th><th>Student</th><th>Due</th><th>Total</th><th>Paid</th><th>Status</th></tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id} className={rowClass}>
                  <td className="py-2"><Link className="font-mono text-xs text-brand" href={`/fees/invoices/${i.id}`}>{i.voucherNo}</Link></td>
                  <td>{fullName(i.student)} <span className="text-xs opacity-50">{i.student.admissionNo}</span></td>
                  <td>{day(i.dueDate)}</td>
                  <td>{rupees(i.total)}</td>
                  <td>{rupees(i.paid)}</td>
                  <td><Badge tone={tone(i.status)}>{i.status.toLowerCase()}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="py-6 text-center text-sm opacity-60">No vouchers for this month yet.</p>}
        </div>
      </Card>
    </>
  );
}

function DefaultersTab() {
  const defaulters = useApi<Defaulter[]>("/fees/defaulters");
  const [period, setPeriod] = useState(thisMonth());
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const rows = defaulters.data ?? [];

  async function remind() {
    try {
      const res = await api<{ invoices: number; messages: number }>("/fees/reminders", { method: "POST", body: { period } });
      setNotice(`Sent ${res.messages} WhatsApp reminders for ${res.invoices} unpaid vouchers.`);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Remind parents for</span>
            <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-lg border border-black/15 bg-transparent px-3 py-2 dark:border-white/20" />
          </label>
          <Button onClick={remind}>Send WhatsApp reminders</Button>
        </div>
      </Card>
      <Notice>{notice}</Notice>
      <ErrorText>{error || defaulters.error}</ErrorText>
      <Card>
        <h2 className="mb-3 font-semibold">
          Overdue: {rows.length} vouchers, {rupees(rows.reduce((s, r) => s + r.balance, 0))} outstanding
        </h2>
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <thead className="opacity-60">
              <tr><th className="py-2">Student</th><th>Month</th><th>Balance</th><th>Late fine</th><th>Days late</th><th>Guardian</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.invoiceId} className={rowClass}>
                  <td className="py-2"><Link className="text-brand" href={`/fees/invoices/${r.invoiceId}`}>{fullName(r.student)}</Link></td>
                  <td>{r.period}</td>
                  <td>{rupees(r.balance)}</td>
                  <td>{r.lateFine ? rupees(r.lateFine) : "–"}</td>
                  <td>{r.daysOverdue}</td>
                  <td>{r.student.guardians[0] ? `${r.student.guardians[0].guardian.name}, ${r.student.guardians[0].guardian.phone}` : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="py-6 text-center text-sm opacity-60">Nobody is overdue.</p>}
        </div>
      </Card>
    </>
  );
}

function SetupTab() {
  const heads = useApi<FeeHead[]>("/fees/heads");
  const classes = useApi<SchoolClass[]>("/classes");
  const years = useApi<Year[]>("/academic-years");
  const year = years.data?.find((y) => y.isCurrent) ?? years.data?.[0];
  const structures = useApi<Structure[]>(year ? `/fees/structures?academicYearId=${year.id}` : null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function addHead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const f = new FormData(formEl);
    try {
      await api("/fees/heads", { method: "POST", body: { name: f.get("name"), frequency: f.get("frequency") } });
      formEl.reset();
      setError("");
      await heads.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function setAmount(classId: string, feeHeadId: string, value: string) {
    if (!year || value === "") return;
    try {
      await api("/fees/structures", {
        method: "PUT",
        body: { classId, feeHeadId, academicYearId: year.id, amount: Number(value) },
      });
      setNotice("Saved.");
      setError("");
      await structures.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const amount = (classId: string, feeHeadId: string) =>
    structures.data?.find((s) => s.classId === classId && s.feeHeadId === feeHeadId)?.amount;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
      <Card>
        <h2 className="mb-3 font-semibold">Fee heads</h2>
        <ul className="mb-4 flex flex-col gap-1 text-sm">
          {heads.data?.map((h) => (
            <li key={h.id} className="flex justify-between"><span>{h.name}</span><Badge>{h.frequency.toLowerCase().replace("_", " ")}</Badge></li>
          ))}
        </ul>
        <form onSubmit={addHead} className="flex flex-col gap-3">
          <Field label="Name" name="name" placeholder="Tuition" required />
          <Select label="Billed" name="frequency" options={[{ value: "MONTHLY", label: "Every month" }, { value: "ANNUAL", label: "Once a year (first month)" }, { value: "ONE_TIME", label: "One time" }]} />
          <Button type="submit">Add fee head</Button>
        </form>
      </Card>
      <Card>
        <h2 className="mb-1 font-semibold">Monthly fee by class {year ? `(${year.name})` : ""}</h2>
        <p className="mb-3 text-xs opacity-60">Amounts in rupees. Changes save when you leave the box.</p>
        <Notice>{notice}</Notice>
        <ErrorText>{error}</ErrorText>
        {!year ? (
          <p className="text-sm opacity-70">Add an academic year on the Classes page first.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead className="opacity-60">
                <tr><th className="py-2">Class</th>{heads.data?.map((h) => <th key={h.id}>{h.name}</th>)}</tr>
              </thead>
              <tbody>
                {classes.data?.map((c) => (
                  <tr key={c.id} className={rowClass}>
                    <td className="py-2 font-medium">{c.name} <span className="text-xs opacity-50">{c.campus.name}</span></td>
                    {heads.data?.map((h) => (
                      <td key={h.id}>
                        <input
                          type="number"
                          min={0}
                          defaultValue={amount(c.id, h.id)}
                          key={`${c.id}-${h.id}-${amount(c.id, h.id) ?? ""}`}
                          onBlur={(e) => e.target.value !== String(amount(c.id, h.id) ?? "") && setAmount(c.id, h.id, e.target.value)}
                          className="w-24 rounded-lg border border-black/15 bg-transparent px-2 py-1 dark:border-white/20"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
