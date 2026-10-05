"use client";

import { useState, type FormEvent } from "react";
import { ArrowDownLeft, ArrowUpRight, BookOpen, Download, Landmark, Plus, Scale, Tags, Trash2, Wallet } from "lucide-react";
import { DateRange } from "@/components/date-range";
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  Drawer,
  IconButton,
  KpiCard,
  PageHeader,
  SegmentedControl,
  SelectField,
  StatGrid,
  TabPanel,
  Tabs,
  TextField,
  useToast,
  type Column,
} from "@/components/ui";
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
type Range = { from: string; to: string };
type BookRow = Row & { key: string; opening?: boolean };

const TABS = [
  { value: "cash", label: "Cash book", icon: <BookOpen /> },
  { value: "entries", label: "Income and expenses", icon: <Tags /> },
];
const monthStart = () => `${todayIso().slice(0, 7)}-01`;
const methodText = (m: string) => m.charAt(0) + m.slice(1).toLowerCase();

export default function AccountsPage() {
  const [tab, setTab] = useState("cash");
  const [range, setRange] = useState({ from: monthStart(), to: todayIso() });
  const [entryOpen, setEntryOpen] = useState(false);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Accounts"
        description="Money in and out of the school. Fee receipts and paid salaries are added automatically."
        breadcrumbs={[{ label: "Finance" }, { label: "Accounts" }]}
        actions={
          <Button
            icon={<Plus />}
            onClick={() => {
              setTab("entries");
              setEntryOpen(true);
            }}
          >
            Record entry
          </Button>
        }
      />
      <Tabs tabs={TABS} value={tab} onValueChange={setTab} aria-label="Accounts sections">
        <DateRange from={range.from} to={range.to} onChange={setRange} className="pt-5" />
        <TabPanel value="cash">
          <CashBook range={range} />
        </TabPanel>
        <TabPanel value="entries">
          <Entries range={range} drawerOpen={entryOpen} setDrawerOpen={setEntryOpen} />
        </TabPanel>
      </Tabs>
    </div>
  );
}

function CashBook({ range }: { range: Range }) {
  const book = useApi<Book>(`/accounts/cashbook?from=${range.from}&to=${range.to}`);
  const b = book.data;
  const loading = !b && !book.error;

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

  const rows: BookRow[] | null = b
    ? [
        { key: "opening", opening: true, date: b.from, flow: "IN", amount: 0, source: "ENTRY", description: "Opening balance", method: "", balance: b.opening },
        ...b.rows.map((r, i) => ({ ...r, key: String(i) })),
      ]
    : null;

  const columns: Column<BookRow>[] = [
    { id: "date", header: "Date", width: "120px", cell: (r) => <span className="whitespace-nowrap">{day(r.date)}</span> },
    {
      id: "description",
      header: "Description",
      cell: (r) =>
        r.opening ? (
          <span className="font-medium text-fg">Opening balance</span>
        ) : (
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-fg">{r.description}</span>
            {r.source !== "ENTRY" && <Badge tone={r.source === "FEES" ? "success" : "info"}>{r.source === "FEES" ? "Fees" : "Salary"}</Badge>}
          </span>
        ),
    },
    { id: "method", header: "Method", hideBelow: "md", cell: (r) => (r.method ? <span className="text-xs text-fg-secondary">{methodText(r.method)}</span> : null) },
    { id: "in", header: "In", align: "right", cell: (r) => (!r.opening && r.flow === "IN" ? <span className="text-success-text">{rupees(r.amount)}</span> : null) },
    { id: "out", header: "Out", align: "right", cell: (r) => (!r.opening && r.flow === "OUT" ? <span className="text-danger-text">{rupees(r.amount)}</span> : null) },
    { id: "balance", header: "Balance", align: "right", cell: (r) => <span className={r.opening ? "font-medium text-fg" : "text-fg"}>{rupees(r.balance)}</span> },
  ];

  const cell = "px-4 py-3";
  return (
    <div className="flex flex-col gap-6">
      <StatGrid>
        <KpiCard label="Opening" value={rupees(b?.opening ?? 0)} icon={<Landmark />} tone="neutral" error={!b && !!book.error} loading={loading} />
        <KpiCard label="Money in" value={rupees(b?.totalIn ?? 0)} icon={<ArrowDownLeft />} tone="success" error={!b && !!book.error} loading={loading} />
        <KpiCard label="Money out" value={rupees(b?.totalOut ?? 0)} icon={<ArrowUpRight />} tone="danger" error={!b && !!book.error} loading={loading} />
        <KpiCard label="Closing" value={rupees(b?.closing ?? 0)} icon={<Scale />} error={!b && !!book.error} loading={loading} />
      </StatGrid>
      <DataTable
        label="Cash book"
        columns={columns}
        data={rows}
        error={book.error}
        onRetry={book.reload}
        getRowId={(r) => r.key}
        pageSize={0}
        maxHeight="65vh"
        rowClassName={(r) => (r.opening ? "font-medium" : undefined)}
        toolbarActions={
          <Button variant="secondary" size="sm" icon={<Download />} onClick={exportCsv} disabled={!b}>
            Download for Excel
          </Button>
        }
        footer={
          b && (
            <tr className="border-t border-border-strong bg-surface-2 font-semibold text-fg">
              <td className={cell}>{day(b.to)}</td>
              <td className={cell}>Closing balance</td>
              <td className={`${cell} hidden md:table-cell`} />
              <td className={`${cell} text-end tabular-nums`}>{rupees(b.totalIn)}</td>
              <td className={`${cell} text-end tabular-nums`}>{rupees(b.totalOut)}</td>
              <td className={`${cell} text-end tabular-nums`}>{rupees(b.closing)}</td>
            </tr>
          )
        }
      />
      <p className="text-xs text-fg-muted">Fee receipts and paid salaries come in automatically. Record everything else on the Income and expenses tab.</p>
    </div>
  );
}

function Entries({ range, drawerOpen, setDrawerOpen }: { range: Range; drawerOpen: boolean; setDrawerOpen: (open: boolean) => void }) {
  const toast = useToast();
  const user = useSession();
  const canDelete = hasRole(user, SETUP);
  const entries = useApi<Entry[]>(`/accounts/entries?from=${range.from}&to=${range.to}`);
  const categories = useApi<Category[]>("/accounts/categories");
  const [kind, setKind] = useState<"EXPENSE" | "INCOME">("EXPENSE");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [categoryError, setCategoryError] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [toDelete, setToDelete] = useState<Entry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const options = (categories.data ?? []).filter((c) => c.kind === kind);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const f = new FormData(form);
    setSaving(true);
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
      setDrawerOpen(false);
      toast.success(kind === "EXPENSE" ? "Expense saved" : "Income saved");
      await entries.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setAddingCategory(true);
    try {
      await api("/accounts/categories", { method: "POST", body: { name: new FormData(form).get("name"), kind } });
      form.reset();
      setCategoryError("");
      toast.success("Category added");
      await categories.reload();
    } catch (e) {
      setCategoryError((e as Error).message);
    } finally {
      setAddingCategory(false);
    }
  }

  async function remove() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api(`/accounts/entries/${toDelete.id}`, { method: "DELETE" });
      toast.success("Entry deleted");
      setToDelete(null);
      await entries.reload();
    } catch (err) {
      toast.error("Could not delete the entry", (err as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  const income = entries.data?.filter((e) => e.kind === "INCOME").reduce((s, e) => s + e.amount, 0) ?? 0;
  const expense = entries.data?.filter((e) => e.kind === "EXPENSE").reduce((s, e) => s + e.amount, 0) ?? 0;
  const loading = !entries.data && !entries.error;

  const columns: Column<Entry>[] = [
    { id: "date", header: "Date", sortValue: (e) => e.date, cell: (e) => <span className="whitespace-nowrap">{day(e.date)}</span> },
    {
      id: "category",
      header: "Category",
      sortValue: (e) => e.category.name,
      cell: (e) => (
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-fg">{e.category.name}</span>
          <Badge tone={e.kind === "INCOME" ? "success" : "danger"}>{e.kind === "INCOME" ? "Income" : "Expense"}</Badge>
        </span>
      ),
    },
    {
      id: "party",
      header: "Paid to or from",
      hideBelow: "md",
      sortValue: (e) => e.party,
      cell: (e) => (
        <div>
          <div className="text-fg">{e.party}</div>
          {e.note && <div className="text-xs text-fg-muted">{e.note}</div>}
        </div>
      ),
    },
    {
      id: "method",
      header: "Method",
      hideBelow: "lg",
      cell: (e) => (
        <span className="text-xs text-fg-secondary">
          {methodText(e.method)}
          {e.reference ? `, ${e.reference}` : ""}
        </span>
      ),
    },
    {
      id: "amount",
      header: "Amount",
      align: "right",
      sortValue: (e) => e.amount,
      cell: (e) => <span className={e.kind === "INCOME" ? "font-medium text-success-text" : "font-medium text-fg"}>{rupees(e.amount)}</span>,
    },
    ...(canDelete
      ? [
          {
            id: "actions",
            header: <span className="sr-only">Actions</span>,
            width: "56px",
            cell: (e: Entry) => (
              <IconButton size="sm" aria-label={`Delete ${e.category.name} ${rupees(e.amount)}`} onClick={() => setToDelete(e)}>
                <Trash2 />
              </IconButton>
            ),
          },
        ]
      : []),
  ];

  const openDrawer = () => {
    setError("");
    setDrawerOpen(true);
  };

  return (
    <div className="flex flex-col gap-6">
      <StatGrid cols={3}>
        <KpiCard label="Other income" value={rupees(income)} icon={<ArrowDownLeft />} tone="success" error={!entries.data && !!entries.error} loading={loading} />
        <KpiCard label="Expenses" value={rupees(expense)} icon={<ArrowUpRight />} tone="danger" error={!entries.data && !!entries.error} loading={loading} />
        <KpiCard label="Net" value={rupees(income - expense)} icon={<Wallet />} tone={income - expense >= 0 ? "primary" : "warning"} error={!entries.data && !!entries.error} loading={loading} hint="Not counting fees and salaries" />
      </StatGrid>
      <DataTable
        label="Income and expense entries"
        columns={columns}
        data={entries.data}
        error={entries.error}
        onRetry={entries.reload}
        getRowId={(e) => e.id}
        getSearchText={(e) => `${e.category.name} ${e.party ?? ""} ${e.note ?? ""} ${e.reference ?? ""}`}
        searchPlaceholder="Search category, party or note"
        defaultSort={{ id: "date", dir: "desc" }}
        toolbarActions={
          <Button size="sm" icon={<Plus />} onClick={openDrawer}>
            Record entry
          </Button>
        }
        empty={{
          icon: <Tags />,
          title: "Nothing recorded in these dates",
          description: "Record rent, utilities, canteen income and other money that is not fees or salaries.",
          action: (
            <Button icon={<Plus />} onClick={openDrawer}>
              Record entry
            </Button>
          ),
        }}
      />

      <Drawer
        open={drawerOpen}
        onOpenChange={(o) => {
          if (o) setError("");
          setDrawerOpen(o);
        }}
        title="Record entry"
        description="For money that is not a fee receipt or a salary."
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setDrawerOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="account-entry" loading={saving} disabled={!options.length}>
              Save
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          <SegmentedControl
            aria-label="Entry type"
            size="md"
            value={kind}
            onChange={setKind}
            options={[
              { value: "EXPENSE", label: "Expense", icon: <ArrowUpRight /> },
              { value: "INCOME", label: "Other income", icon: <ArrowDownLeft /> },
            ]}
          />
          <form id="account-entry" className="grid gap-4 sm:grid-cols-2" onSubmit={add}>
            <SelectField
              label="Category"
              name="categoryId"
              required
              options={options.map((c) => ({ value: c.id, label: c.name }))}
              placeholder={options.length ? undefined : "Add a category below first"}
              wrapperClassName="sm:col-span-2"
            />
            <TextField label="Amount (Rs)" name="amount" type="number" min={1} required inputMode="numeric" />
            <TextField label="Date" name="date" type="date" max={todayIso()} defaultValue={todayIso()} required />
            <TextField label={kind === "EXPENSE" ? "Paid to" : "Received from"} name="party" wrapperClassName="sm:col-span-2" />
            <SelectField
              label="Method"
              name="method"
              options={[
                { value: "CASH", label: "Cash" },
                { value: "BANK", label: "Bank" },
                { value: "CHEQUE", label: "Cheque" },
              ]}
            />
            <TextField label="Reference (optional)" name="reference" placeholder="Bill or cheque number" />
            <TextField label="Note (optional)" name="note" wrapperClassName="sm:col-span-2" />
            {error && (
              <Alert tone="danger" className="sm:col-span-2">
                {error}
              </Alert>
            )}
          </form>

          <Card padding="sm" className="bg-surface-2 shadow-none">
            <h3 className="text-sm font-semibold text-fg">Add {kind === "EXPENSE" ? "an expense" : "an income"} category</h3>
            <form className="mt-3 flex gap-2" onSubmit={addCategory}>
              <TextField
                name="name"
                required
                aria-label="Category name"
                placeholder={kind === "EXPENSE" ? "Utilities" : "Canteen rent"}
                wrapperClassName="min-w-0 flex-1"
              />
              <Button type="submit" variant="secondary" loading={addingCategory}>
                Add
              </Button>
            </form>
            {categoryError && <p className="mt-2 text-xs text-danger-text" role="alert">{categoryError}</p>}
            {categories.error && <p className="mt-2 text-xs text-danger-text" role="alert">Could not load categories: {categories.error}</p>}
          </Card>
        </div>
      </Drawer>

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete this entry?"
        description={toDelete ? `${toDelete.category.name}, ${rupees(toDelete.amount)} on ${day(toDelete.date)}. This cannot be undone.` : ""}
        confirmLabel="Delete entry"
        destructive
        loading={deleting}
        onConfirm={remove}
      />
    </div>
  );
}
