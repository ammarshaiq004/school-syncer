"use client";

import { useState, type FormEvent } from "react";
import { DateRange } from "@/components/date-range";
import { Select } from "@/components/select";
import { Badge, Button, Card, ErrorText, Field, Notice, PageTitle, rowClass, tableClass } from "@/components/ui";
import { api } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { day, rupees, todayIso } from "@/lib/format";
import { hasRole, SETUP, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

interface Row {
  date: string;
  flow: "IN" | "OUT";
  amount: number;
  source: "FEES" | "SALARY" | "ENTRY";
  description: string;
  method: string;
  reference?: string | null;
  balance: number;
}
interface Book { from: string; to: string; opening: number; totalIn: number; totalOut: number; closing: number; rows: Row[] }
interface Category { id: string; name: string; kind: "INCOME" | "EXPENSE" }
interface Entry {
  id: string;
  kind: "INCOME" | "EXPENSE";
  amount: number;
  date: string;
  party: string | null;
  method: string;
  reference: string | null;
  note: string | null;
  category: { name: string };
}

const TABS = ["Cash book", "Income and expenses"] as const;
const monthStart = () => `${todayIso().slice(0, 7)}-01`;

export default function AccountsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Cash book");
  const [range, setRange] = useState({ from: monthStart(), to: todayIso() });
  return (
    <div className="flex flex-col gap-6">
      <PageTitle>Accounts</PageTitle>
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
      <DateRange from={range.from} to={range.to} onChange={setRange} />
      {tab === "Cash book" && <CashBook range={range} />}
      {tab === "Income and expenses" && <Entries range={range} />}
    </div>
  );
}

function CashBook({ range }: { range: { from: string; to: string } }) {
  const book = useApi<Book>(`/accounts/cashbook?from=${range.from}&to=${range.to}`);
  const b = book.data;

  function exportCsv() {
    if (!b) return;
    downloadCsv(
      `cash-book-${b.from}-to-${b.to}.csv`,
      ["Date", "Description", "Method", "Reference", "In", "Out", "Balance"],
      [
        [b.from, "Opening balance", "", "", "", "", b.opening],
        ...b.rows.map((r) => [r.date, r.description, r.method, r.reference, r.flow === "IN" ? r.amount : "", r.flow === "OUT" ? r.amount : "", r.balance]),
        [b.to, "Closing balance", "", "", b.totalIn, b.totalOut, b.closing],
      ],
    );
  }

  return (
    <Card>
      <ErrorText>{book.error}</ErrorText>
      {b && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ["Opening", b.opening],
              ["Money in", b.totalIn],
              ["Money out", b.totalOut],
              ["Closing", b.closing],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-black/5 p-3 dark:bg-white/10">
                <div className="text-xs opacity-60">{label}</div>
                <div className="text-lg font-semibold">{rupees(value as number)}</div>
              </div>
            ))}
          </div>
          <div className="mb-2 flex justify-end">
            <Button variant="ghost" onClick={exportCsv}>Download for Excel</Button>
          </div>
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead className="opacity-60">
                <tr><th className="py-2">Date</th><th>Description</th><th>Method</th><th className="text-right">In</th><th className="text-right">Out</th><th className="text-right">Balance</th></tr>
              </thead>
              <tbody>
                <tr className={rowClass}><td className="py-2">{day(b.from)}</td><td className="font-medium">Opening balance</td><td /><td /><td /><td className="text-right font-medium">{rupees(b.opening)}</td></tr>
                {b.rows.map((r, i) => (
                  <tr key={i} className={rowClass}>
                    <td className="py-2 whitespace-nowrap">{day(r.date)}</td>
                    <td>
                      {r.description}{" "}
                      {r.source !== "ENTRY" && <Badge tone={r.source === "FEES" ? "green" : "blue"}>{r.source === "FEES" ? "fees" : "salary"}</Badge>}
                    </td>
                    <td className="text-xs">{r.method.toLowerCase()}</td>
                    <td className="text-right text-green-700 dark:text-green-400">{r.flow === "IN" ? rupees(r.amount) : ""}</td>
                    <td className="text-right text-red-700 dark:text-red-400">{r.flow === "OUT" ? rupees(r.amount) : ""}</td>
                    <td className="text-right">{rupees(r.balance)}</td>
                  </tr>
                ))}
                <tr className={`${rowClass} font-semibold`}><td className="py-2">{day(b.to)}</td><td>Closing balance</td><td /><td className="text-right">{rupees(b.totalIn)}</td><td className="text-right">{rupees(b.totalOut)}</td><td className="text-right">{rupees(b.closing)}</td></tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs opacity-60">Fee receipts and paid salaries come in automatically. Record everything else on the Income and expenses tab.</p>
        </>
      )}
    </Card>
  );
}

function Entries({ range }: { range: { from: string; to: string } }) {
  const user = useSession();
  const canDelete = hasRole(user, SETUP);
  const entries = useApi<Entry[]>(`/accounts/entries?from=${range.from}&to=${range.to}`);
  const categories = useApi<Category[]>("/accounts/categories");
  const [kind, setKind] = useState<"EXPENSE" | "INCOME">("EXPENSE");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const options = (categories.data ?? []).filter((c) => c.kind === kind);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const f = new FormData(form);
    try {
      await api("/accounts/entries", {
        method: "POST",
        body: {
          categoryId: f.get("categoryId"),
          amount: Number(f.get("amount")),
          date: f.get("date"),
          party: f.get("party") || undefined,
          method: f.get("method"),
          reference: f.get("reference") || undefined,
          note: f.get("note") || undefined,
        },
      });
      form.reset();
      setError("");
      setNotice("Saved.");
      await entries.reload();
    } catch (e) {
      setError((e as Error).message);
      setNotice("");
    }
  }

  async function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api("/accounts/categories", { method: "POST", body: { name: new FormData(form).get("name"), kind } });
      form.reset();
      setError("");
      await categories.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove(e: Entry) {
    if (!confirm(`Delete ${e.category.name} ${rupees(e.amount)}?`)) return;
    try {
      await api(`/accounts/entries/${e.id}`, { method: "DELETE" });
      await entries.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <Card>
        <ErrorText>{entries.error}</ErrorText>
        {entries.data?.length === 0 && <p className="text-sm opacity-70">Nothing recorded in these dates.</p>}
        {!!entries.data?.length && (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead className="opacity-60"><tr><th className="py-2">Date</th><th>Category</th><th>Paid to / from</th><th>Method</th><th className="text-right">Amount</th><th /></tr></thead>
              <tbody>
                {entries.data.map((e) => (
                  <tr key={e.id} className={rowClass}>
                    <td className="py-2 whitespace-nowrap">{day(e.date)}</td>
                    <td>{e.category.name} <Badge tone={e.kind === "INCOME" ? "green" : "red"}>{e.kind.toLowerCase()}</Badge></td>
                    <td>{e.party}{e.note && <div className="text-xs opacity-60">{e.note}</div>}</td>
                    <td className="text-xs">{e.method.toLowerCase()}{e.reference ? ` · ${e.reference}` : ""}</td>
                    <td className="text-right font-medium">{rupees(e.amount)}</td>
                    <td>{canDelete && <button className="text-sm text-red-600" onClick={() => remove(e)}>Delete</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="flex flex-col gap-6">
        <Card>
          <div className="mb-4 flex gap-2">
            {(["EXPENSE", "INCOME"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`rounded-full px-3 py-1 text-sm ${kind === k ? "bg-brand text-white" : "bg-black/5 dark:bg-white/10"}`}
              >
                {k === "EXPENSE" ? "Expense" : "Other income"}
              </button>
            ))}
          </div>
          <form className="flex flex-col gap-3" onSubmit={add}>
            <Select label="Category" name="categoryId" required options={options.map((c) => ({ value: c.id, label: c.name }))} />
            <Field label="Amount (Rs)" name="amount" type="number" min={1} required />
            <Field label="Date" name="date" type="date" max={todayIso()} defaultValue={todayIso()} required />
            <Field label={kind === "EXPENSE" ? "Paid to" : "Received from"} name="party" />
            <Select label="Method" name="method" options={[{ value: "CASH", label: "Cash" }, { value: "BANK", label: "Bank" }, { value: "CHEQUE", label: "Cheque" }]} />
            <Field label="Reference (optional)" name="reference" placeholder="Bill or cheque number" />
            <Field label="Note (optional)" name="note" />
            <Button type="submit" disabled={!options.length}>Save</Button>
            <Notice>{notice}</Notice>
            <ErrorText>{error}</ErrorText>
          </form>
        </Card>
        <Card>
          <h2 className="mb-3 text-sm font-semibold">Add a {kind === "EXPENSE" ? "expense" : "income"} category</h2>
          <form className="flex gap-2" onSubmit={addCategory}>
            <input name="name" required placeholder={kind === "EXPENSE" ? "Utilities" : "Canteen rent"} className="min-w-0 flex-1 rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20" />
            <Button type="submit" variant="ghost">Add</Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
