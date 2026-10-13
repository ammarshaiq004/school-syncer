"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { BellRing, CircleAlert, FilePlus2, Plus, ReceiptText, Send, Wallet, Banknote, CalendarClock, Globe, CircleCheck, Clock, ScanSearch, Undo2 } from "lucide-react";
import { CHECKOUT_LABEL, CHECKOUT_TONE, PROVIDER_LABEL, type Checkout, type CheckoutStatus } from "@/components/invoices/online-payment";
import { InvoiceStatusPill, invoiceDisplay } from "@/components/fees/invoice-status";
import { ReasonDialog } from "@/components/fees/reason-dialog";
import { ReconciliationTab } from "@/components/fees/reconciliation-tab";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  KpiCard,
  NativeSelect,
  PageHeader,
  SelectField,
  SkeletonRows,
  StatGrid,
  TabPanel,
  Tabs,
  TextField,
  useToast,
  type Column,
} from "@/components/ui";
import { inputClass } from "@/components/kit/styles";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { day, fullName, plural, rupees, thisMonth, todayIso } from "@/lib/format";
import { can, useSession } from "@/lib/session";
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

const TABS = [
  { value: "invoices", label: "Invoices", icon: <ReceiptText /> },
  { value: "payments", label: "Payments", icon: <Banknote /> },
  { value: "defaulters", label: "Defaulters", icon: <BellRing /> },
  { value: "online", label: "Online payments", icon: <Globe /> },
  { value: "reconciliation", label: "Reconciliation", icon: <ScanSearch /> },
  { value: "setup", label: "Fee setup", icon: <Wallet /> },
];

const STATUS_OPTIONS = [
  { value: "UNPAID", label: "Unpaid" },
  { value: "PARTIAL", label: "Partially paid" },
  { value: "PAID", label: "Paid" },
  { value: "CANCELLED", label: "Cancelled" },
];

const FREQUENCY_LABEL: Record<string, string> = { MONTHLY: "Every month", ANNUAL: "Once a year", ONE_TIME: "One time" };

const monthLabel = (period: string) =>
  /^\d{4}-\d{2}$/.test(period)
    ? new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
    : period;

export default function FeesPage() {
  const toast = useToast();
  const user = useSession();
  const onlinePayments = user.plan?.features.includes("online_payments") !== false;
  const tabs = TABS.filter((t) => (t.value !== "online" && t.value !== "reconciliation") || onlinePayments);
  const [tab, setTab] = useState("invoices");
  // A link may point straight at a tab, e.g. /fees#defaulters from the dashboard.
  useEffect(() => {
    const wanted = window.location.hash.slice(1);
    // Reading the address bar on mount is exactly what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (tabs.some((t) => t.value === wanted)) setTab(wanted);
    // Only on first load; the tab list does not change while the page is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [period, setPeriod] = useState(thisMonth());
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const query = new URLSearchParams({ period, ...(status && { status }), ...(search && { search }) }).toString();
  const invoices = useApi<Invoice[]>(`/fees/invoices?${query}`);
  const [generateOpen, setGenerateOpen] = useState(false);
  // Remount the dialog each time it opens so it starts on the month being viewed.
  const [generateKey, setGenerateKey] = useState(0);
  const openGenerate = () => {
    setGenerateKey((k) => k + 1);
    setGenerateOpen(true);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Fees"
        description="Monthly vouchers, overdue balances and the fee each class pays."
        breadcrumbs={[{ label: "Finance" }, { label: "Fees" }]}
        actions={
          <Button icon={<FilePlus2 />} onClick={openGenerate}>
            Generate vouchers
          </Button>
        }
      />
      <GenerateDialog
        key={generateKey}
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        initialPeriod={period}
        onDone={async (p, message) => {
          toast.success("Vouchers generated", message);
          setTab("invoices");
          if (p !== period) setPeriod(p);
          else await invoices.reload();
        }}
      />
      <Tabs tabs={tabs} value={tab} onValueChange={setTab} aria-label="Fees sections">
        <TabPanel value="invoices">
          <InvoicesTab
            invoices={invoices}
            period={period}
            setPeriod={setPeriod}
            status={status}
            setStatus={setStatus}
            search={search}
            setSearch={setSearch}
            onGenerate={openGenerate}
          />
        </TabPanel>
        <TabPanel value="payments">
          <PaymentsTab />
        </TabPanel>
        <TabPanel value="defaulters">
          <DefaultersTab />
        </TabPanel>
        <TabPanel value="online">
          <OnlinePaymentsTab />
        </TabPanel>
        <TabPanel value="reconciliation">
          <ReconciliationTab />
        </TabPanel>
        <TabPanel value="setup">
          <SetupTab />
        </TabPanel>
      </Tabs>
    </div>
  );
}

function GenerateDialog({
  open,
  onOpenChange,
  initialPeriod,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPeriod: string;
  onDone: (period: string, message: string) => Promise<void> | void;
}) {
  const [period, setPeriod] = useState(initialPeriod);
  const [sendWhatsApp, setSendWhatsApp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const res = await api<{ created: number; skipped: number; totalBilled: number; messages: number }>(
        "/fees/invoices/generate",
        { method: "POST", body: { period, sendWhatsApp } },
      );
      const message =
        `Created ${res.created} vouchers totalling ${rupees(res.totalBilled)}.` +
        (res.messages ? ` ${res.messages} sent on WhatsApp.` : "") +
        (res.created === 0 ? " Everyone already has a voucher for this month, or no fee structure is set." : "");
      setError("");
      onOpenChange(false);
      await onDone(period, message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Generate vouchers"
      description="Bills every active student for the month using the fee setup. Students who already have a voucher for the month are skipped, so it is safe to run again."
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="generate-vouchers" loading={busy} icon={sendWhatsApp ? <Send /> : <FilePlus2 />}>
            {sendWhatsApp ? "Generate and send" : "Generate vouchers"}
          </Button>
        </>
      }
    >
      <form id="generate-vouchers" onSubmit={generate} className="flex flex-col gap-4">
        <TextField label="Month" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} required />
        <Checkbox checked={sendWhatsApp} onCheckedChange={setSendWhatsApp} label="Also send each voucher to parents on WhatsApp" />
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}

function InvoicesTab({
  invoices,
  period,
  setPeriod,
  status,
  setStatus,
  search,
  setSearch,
  onGenerate,
}: {
  invoices: { data: Invoice[] | null; error: string; reload: () => Promise<void> };
  period: string;
  setPeriod: (v: string) => void;
  status: string;
  setStatus: (v: string) => void;
  search: string;
  setSearch: (v: string) => void;
  onGenerate: () => void;
}) {
  const router = useRouter();
  const rows = invoices.data;
  // Voided vouchers bill nothing.
  const live = rows?.filter((i) => i.status !== "CANCELLED");
  const billed = live?.reduce((s, i) => s + i.total, 0) ?? 0;
  const collected = live?.reduce((s, i) => s + i.paid, 0) ?? 0;
  const outstanding = rows?.filter((i) => i.status !== "CANCELLED").reduce((s, i) => s + Math.max(0, i.total - i.paid), 0) ?? 0;
  const overdue = rows?.filter((i) => invoiceDisplay(i) === "OVERDUE") ?? [];
  const loading = !rows && !invoices.error;
  const rate = billed ? Math.round((collected / billed) * 1000) / 10 : 0;

  const columns: Column<Invoice>[] = [
    {
      id: "voucher",
      header: "Voucher",
      sortValue: (i) => i.voucherNo,
      cell: (i) => (
        <Link className="font-mono text-xs font-medium text-brand hover:underline" href={`/fees/invoices/${i.id}`}>
          {i.voucherNo}
        </Link>
      ),
    },
    {
      id: "student",
      header: "Student",
      sortValue: (i) => fullName(i.student),
      cell: (i) => (
        <div className="min-w-0">
          <div className="font-medium text-fg">{fullName(i.student)}</div>
          <div className="text-xs text-fg-muted">{i.student.admissionNo}</div>
        </div>
      ),
    },
    { id: "due", header: "Due", sortValue: (i) => i.dueDate, cell: (i) => day(i.dueDate), hideBelow: "md" },
    { id: "total", header: "Total", align: "right", sortValue: (i) => i.total, cell: (i) => rupees(i.total) },
    { id: "paid", header: "Paid", align: "right", sortValue: (i) => i.paid, cell: (i) => rupees(i.paid), hideBelow: "sm" },
    { id: "status", header: "Status", sortValue: (i) => invoiceDisplay(i), cell: (i) => <InvoiceStatusPill invoice={i} /> },
  ];

  return (
    <div className="flex flex-col gap-6">
      <StatGrid>
        <KpiCard label="Billed" value={rupees(billed)} icon={<ReceiptText />} loading={loading} hint={live ? `${live.length} vouchers` : undefined} />
        <KpiCard label="Collected" value={rupees(collected)} icon={<Banknote />} tone="success" loading={loading} hint={rows ? `${rate}% of billed` : undefined} />
        <KpiCard label="Outstanding" value={rupees(outstanding)} icon={<Wallet />} tone="warning" loading={loading} />
        <KpiCard label="Overdue vouchers" value={overdue.length.toLocaleString("en-PK")} icon={<CircleAlert />} tone="danger" loading={loading} hint={rows ? "Past the due date" : undefined} />
      </StatGrid>
      <DataTable
        label="Fee vouchers"
        columns={columns}
        data={rows}
        error={invoices.error}
        onRetry={invoices.reload}
        getRowId={(i) => i.id}
        search={search}
        onSearchChange={setSearch}
        manualFiltering
        getSearchText={(i) => `${fullName(i.student)} ${i.student.admissionNo} ${i.voucherNo}`}
        searchPlaceholder="Search name, admission or voucher no."
        filters={
          <>
            <input
              type="month"
              aria-label="Month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className={cn(inputClass, "h-9 w-40")}
            />
            <NativeSelect
              aria-label="Status"
              placeholder="All statuses"
              options={STATUS_OPTIONS}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              wrapperClassName="w-40"
            />
          </>
        }
        filtered={!!status || !!search}
        defaultSort={{ id: "voucher", dir: "asc" }}
        onRowClick={(i) => router.push(`/fees/invoices/${i.id}`)}
        getRowLabel={(i) => `Voucher ${i.voucherNo} for ${fullName(i.student)}`}
        empty={{
          icon: <ReceiptText />,
          title: `No vouchers for ${monthLabel(period)} yet`,
          description: "Generate this month's vouchers to bill every active student.",
          action: (
            <Button icon={<FilePlus2 />} onClick={onGenerate}>
              Generate vouchers
            </Button>
          ),
        }}
      />
    </div>
  );
}

interface Receipt {
  id: string;
  amount: number;
  method: string;
  reference: string | null;
  receiptNo: string;
  receivedAt: string;
  reversedAt: string | null;
  reversalReason: string | null;
  online: boolean;
  receivedBy: { name: string } | null;
  invoice: { id: string; voucherNo: string; period: string; student: { id: string; firstName: string; lastName: string | null; admissionNo: string } };
}

const METHOD_LABEL: Record<string, string> = { CASH: "Cash", BANK: "Bank", JAZZCASH: "JazzCash", EASYPAISA: "Easypaisa", ONEBILL: "1Bill", CARD: "Card" };
const RECEIPT_OPTIONS = [
  { value: "false", label: "Counted" },
  { value: "true", label: "Reversed" },
];

/** Every receipt, counter and online, with a reason-required reverse for fee managers. */
function PaymentsTab() {
  const toast = useToast();
  const user = useSession();
  const canManage = can(user, "fees", "manage") && user.plan?.access !== "read_only";
  const [from, setFrom] = useState(`${thisMonth()}-01`);
  const [to, setTo] = useState(todayIso());
  const [reversed, setReversed] = useState("");
  const query = new URLSearchParams({ from, to, ...(reversed && { reversed }) }).toString();
  const list = useApi<Receipt[]>(`/fees/payments?${query}`);
  const [reversing, setReversing] = useState<Receipt | null>(null);
  const rows = list.data;
  const loading = !rows && !list.error;
  const counted = rows?.filter((r) => !r.reversedAt) ?? [];
  const reversedRows = rows?.filter((r) => r.reversedAt) ?? [];

  async function reverse(reason: string) {
    if (!reversing) return;
    await api(`/fees/payments/${reversing.id}/reverse`, { method: "POST", body: { reason } });
    toast.success("Payment reversed", `Receipt ${reversing.receiptNo} no longer counts.`);
    await list.reload();
  }

  const columns: Column<Receipt>[] = [
    {
      id: "receipt",
      header: "Receipt",
      sortValue: (r) => r.receivedAt,
      cell: (r) => (
        <div className="min-w-0">
          <div className={cn("font-mono text-xs font-medium text-fg", r.reversedAt && "line-through text-fg-muted")}>{r.receiptNo}</div>
          <div className="text-xs text-fg-muted">{day(r.receivedAt)}</div>
        </div>
      ),
    },
    {
      id: "student",
      header: "Student",
      sortValue: (r) => fullName(r.invoice.student),
      cell: (r) => (
        <div className="min-w-0">
          <Link className="font-medium text-fg hover:text-brand" href={`/fees/invoices/${r.invoice.id}`}>
            {fullName(r.invoice.student)}
          </Link>
          <div className="text-xs text-fg-muted">
            {r.invoice.student.admissionNo} <span className="font-mono">{r.invoice.voucherNo}</span>
          </div>
        </div>
      ),
    },
    {
      id: "method",
      header: "Method",
      sortValue: (r) => r.method,
      hideBelow: "md",
      cell: (r) => (
        <div>
          <div className="text-fg">
            {METHOD_LABEL[r.method] ?? r.method}
            {r.online && <span className="ms-1 text-xs text-fg-muted">online</span>}
          </div>
          {r.reference && <div className="font-mono text-xs text-fg-muted">{r.reference}</div>}
        </div>
      ),
    },
    {
      id: "amount",
      header: "Amount",
      align: "right",
      sortValue: (r) => r.amount,
      cell: (r) => <span className={cn("font-medium tabular-nums", r.reversedAt ? "text-fg-muted line-through" : "text-fg")}>{rupees(r.amount)}</span>,
    },
    {
      id: "status",
      header: "Status",
      sortValue: (r) => (r.reversedAt ? 1 : 0),
      cell: (r) =>
        r.reversedAt ? (
          <div className="flex flex-col items-start gap-0.5">
            <Badge tone="danger">Reversed</Badge>
            {r.reversalReason && <span className="max-w-64 text-xs text-fg-muted">{r.reversalReason}</span>}
          </div>
        ) : (
          <Badge tone="success">Counted</Badge>
        ),
    },
    ...(canManage
      ? [
          {
            id: "actions",
            header: <span className="sr-only">Actions</span>,
            align: "right" as const,
            cell: (r: Receipt) =>
              r.reversedAt ? null : (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Undo2 />}
                  onClick={(e) => {
                    e.stopPropagation();
                    setReversing(r);
                  }}
                >
                  Reverse
                </Button>
              ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <StatGrid cols={3}>
        <KpiCard label="Collected" value={rupees(counted.reduce((s, r) => s + r.amount, 0))} hint={rows ? plural(counted.length, "receipt") : undefined} icon={<Banknote />} tone="success" loading={loading} />
        <KpiCard label="Reversed" value={rupees(reversedRows.reduce((s, r) => s + r.amount, 0))} hint={rows ? plural(reversedRows.length, "receipt") : undefined} icon={<Undo2 />} tone="neutral" loading={loading} />
        <KpiCard label="Online" value={rupees(counted.filter((r) => r.online).reduce((s, r) => s + r.amount, 0))} icon={<Globe />} loading={loading} />
      </StatGrid>
      <DataTable
        label="Payments"
        columns={columns}
        data={rows}
        error={list.error}
        onRetry={list.reload}
        getRowId={(r) => r.id}
        getSearchText={(r) => `${fullName(r.invoice.student)} ${r.invoice.student.admissionNo} ${r.invoice.voucherNo} ${r.receiptNo} ${r.reference ?? ""}`}
        searchPlaceholder="Search student, voucher, receipt or reference"
        defaultSort={{ id: "receipt", dir: "desc" }}
        filtered={!!reversed}
        filters={
          <>
            <input type="date" aria-label="From" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={cn(inputClass, "h-9 w-40")} />
            <input type="date" aria-label="To" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={cn(inputClass, "h-9 w-40")} />
            <NativeSelect aria-label="Status" placeholder="All receipts" options={RECEIPT_OPTIONS} value={reversed} onChange={(e) => setReversed(e.target.value)} wrapperClassName="w-40" />
          </>
        }
        empty={{ icon: <Banknote />, title: "No payments in these dates", description: "Payments taken at the counter, by bank or online show here." }}
      />
      <ReasonDialog
        open={!!reversing}
        onOpenChange={(o) => !o && setReversing(null)}
        title="Reverse this payment?"
        description={
          reversing
            ? `Receipt ${reversing.receiptNo} for ${rupees(reversing.amount)} stays on record but no longer counts towards voucher ${reversing.invoice.voucherNo}, the cash book or reports.`
            : ""
        }
        confirmLabel="Reverse payment"
        placeholder="Entered against the wrong student"
        onConfirm={reverse}
      />
    </div>
  );
}

interface OnlineRow extends Checkout {
  voucherNo: string;
  period: string;
  student: { id: string; name: string; admissionNo: string };
}
interface OnlineList {
  mode: "mock" | "sandbox" | "live" | "off";
  summary: Record<CheckoutStatus, { count: number; amount: number }>;
  items: OnlineRow[];
}

const CHECKOUT_OPTIONS = (Object.keys(CHECKOUT_LABEL) as CheckoutStatus[]).map((value) => ({ value, label: CHECKOUT_LABEL[value] }));

/** Parents' JazzCash, Easypaisa and 1Bill checkouts; paid ones are already on the vouchers and in the cash book. */
function OnlinePaymentsTab() {
  const [status, setStatus] = useState("");
  const list = useApi<OnlineList>(`/fees/online-payments${status ? `?status=${status}` : ""}`);
  const data = list.data;
  const loading = !data && !list.error;
  const columns: Column<OnlineRow>[] = [
    {
      id: "student",
      header: "Student",
      sortValue: (r) => r.student.name,
      cell: (r) => (
        <div className="min-w-0">
          <Link className="font-medium text-fg hover:text-brand" href={`/fees/invoices/${r.invoiceId}`}>
            {r.student.name}
          </Link>
          <div className="text-xs text-fg-muted">
            {r.student.admissionNo} <span className="font-mono">{r.voucherNo}</span>
          </div>
        </div>
      ),
    },
    { id: "provider", header: "Gateway", sortValue: (r) => r.provider, cell: (r) => PROVIDER_LABEL[r.provider] },
    { id: "amount", header: "Amount", align: "right", sortValue: (r) => r.amount, cell: (r) => <span className="font-medium text-fg">{rupees(r.amount)}</span> },
    {
      id: "status",
      header: "Status",
      sortValue: (r) => r.status,
      cell: (r) => (
        <div className="flex flex-col items-start gap-0.5">
          <Badge tone={r.expired ? "neutral" : CHECKOUT_TONE[r.status]}>{r.expired ? "Timed out" : CHECKOUT_LABEL[r.status]}</Badge>
          {r.status === "REVIEW" && r.message && <span className="max-w-64 text-xs text-fg-muted">{r.message}</span>}
        </div>
      ),
    },
    {
      id: "ref",
      header: "Reference",
      hideBelow: "lg",
      cell: (r) => (
        <div className="font-mono text-xs text-fg-secondary">
          {r.receiptNo && <div className="text-fg">{r.receiptNo}</div>}
          <div>{r.providerRef ?? r.consumerNumber ?? r.txnRef}</div>
        </div>
      ),
    },
    { id: "created", header: "Started", hideBelow: "md", sortValue: (r) => r.createdAt, cell: (r) => day(r.createdAt) },
  ];

  return (
    <div className="flex flex-col gap-6">
      {data?.mode === "mock" && (
        <Alert tone="info" title="Online payments are in sandbox mode">
          Parents can try JazzCash, Easypaisa and 1Bill end to end, but no real money moves. Add the merchant credentials and set
          PAYMENTS_MODE to sandbox or live on the server to take real payments.
        </Alert>
      )}
      {data?.mode === "off" && (
        <Alert tone="warning" title="Online payments are switched off on this server">
          Set PAYMENTS_MODE and the gateway credentials to let parents pay online.
        </Alert>
      )}
      <StatGrid cols={3}>
        <KpiCard
          label="Paid online"
          value={rupees(data?.summary.PAID.amount ?? 0)}
          hint={data ? plural(data.summary.PAID.count, "payment") : undefined}
          icon={<CircleCheck />}
          tone="success"
          loading={loading}
        />
        <KpiCard label="Waiting for the gateway" value={(data?.summary.PENDING.count ?? 0).toLocaleString("en-PK")} icon={<Clock />} tone="warning" loading={loading} />
        <KpiCard
          label="Need review"
          value={(data?.summary.REVIEW.count ?? 0).toLocaleString("en-PK")}
          hint="Money taken but not applied"
          icon={<CircleAlert />}
          tone={data?.summary.REVIEW.count ? "danger" : "neutral"}
          loading={loading}
        />
      </StatGrid>
      <DataTable
        label="Online payments"
        columns={columns}
        data={data?.items ?? null}
        error={list.error}
        onRetry={list.reload}
        getRowId={(r) => r.id}
        getSearchText={(r) => `${r.student.name} ${r.student.admissionNo} ${r.voucherNo} ${r.txnRef} ${r.providerRef ?? ""} ${r.consumerNumber ?? ""} ${r.receiptNo ?? ""}`}
        searchPlaceholder="Search student, voucher or transaction"
        defaultSort={{ id: "created", dir: "desc" }}
        filtered={!!status}
        toolbarActions={
          <NativeSelect aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses" options={CHECKOUT_OPTIONS} />
        }
        empty={{
          icon: <Globe />,
          title: "No online payments yet",
          description: "When parents pay a voucher with JazzCash, Easypaisa or 1Bill it shows here and on the voucher.",
        }}
      />
    </div>
  );
}

function DefaultersTab() {
  const toast = useToast();
  const defaulters = useApi<Defaulter[]>("/fees/defaulters");
  const [period, setPeriod] = useState(thisMonth());
  const [busy, setBusy] = useState(false);
  const rows = defaulters.data;
  const loading = !rows && !defaulters.error;

  async function remind() {
    setBusy(true);
    try {
      const res = await api<{ invoices: number; messages: number }>("/fees/reminders", { method: "POST", body: { period } });
      toast.success("Reminders sent", `Sent ${res.messages} WhatsApp reminders for ${res.invoices} unpaid vouchers.`);
    } catch (e) {
      toast.error("Could not send reminders", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const guardian = (r: Defaulter) => r.student.guardians[0]?.guardian;
  const columns: Column<Defaulter>[] = [
    {
      id: "student",
      header: "Student",
      sortValue: (r) => fullName(r.student),
      cell: (r) => (
        <div className="min-w-0">
          <Link className="font-medium text-fg hover:text-brand" href={`/fees/invoices/${r.invoiceId}`}>
            {fullName(r.student)}
          </Link>
          <div className="text-xs text-fg-muted">
            {r.student.admissionNo} <span className="font-mono">{r.voucherNo}</span>
          </div>
        </div>
      ),
    },
    { id: "period", header: "Month", sortValue: (r) => r.period, cell: (r) => monthLabel(r.period), hideBelow: "sm" },
    { id: "balance", header: "Balance", align: "right", sortValue: (r) => r.balance, cell: (r) => <span className="font-medium text-fg">{rupees(r.balance)}</span> },
    { id: "fine", header: "Late fine", align: "right", sortValue: (r) => r.lateFine, cell: (r) => (r.lateFine ? rupees(r.lateFine) : <span className="text-fg-muted">None</span>), hideBelow: "md" },
    {
      id: "days",
      header: "Days late",
      align: "right",
      sortValue: (r) => r.daysOverdue,
      cell: (r) => <Badge tone={r.daysOverdue > 30 ? "danger" : "warning"}>{r.daysOverdue} days</Badge>,
    },
    {
      id: "guardian",
      header: "Guardian",
      hideBelow: "lg",
      cell: (r) => {
        const g = guardian(r);
        return g ? (
          <div>
            <div className="text-fg">{g.name}</div>
            <a className="text-xs text-fg-muted hover:text-brand" href={`tel:${g.phone}`}>
              {g.phone}
            </a>
          </div>
        ) : (
          <span className="text-fg-muted">Not added</span>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <StatGrid cols={3}>
        <KpiCard label="Overdue vouchers" value={(rows?.length ?? 0).toLocaleString("en-PK")} icon={<CircleAlert />} tone="danger" loading={loading} />
        <KpiCard label="Outstanding" value={rupees(rows?.reduce((s, r) => s + r.balance, 0) ?? 0)} icon={<Wallet />} tone="warning" loading={loading} />
        <KpiCard label="Late fines so far" value={rupees(rows?.reduce((s, r) => s + r.lateFine, 0) ?? 0)} icon={<CalendarClock />} tone="neutral" loading={loading} />
      </StatGrid>
      <DataTable
        label="Defaulters"
        columns={columns}
        data={rows}
        error={defaulters.error}
        onRetry={defaulters.reload}
        getRowId={(r) => r.invoiceId}
        getSearchText={(r) => `${fullName(r.student)} ${r.student.admissionNo} ${r.voucherNo} ${guardian(r)?.name ?? ""}`}
        searchPlaceholder="Search student, voucher or guardian"
        defaultSort={{ id: "days", dir: "desc" }}
        toolbarActions={
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="month"
              aria-label="Remind parents for month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className={cn(inputClass, "h-8 w-40")}
            />
            <Button size="sm" icon={<Send />} loading={busy} onClick={remind}>
              Send WhatsApp reminders
            </Button>
          </div>
        }
        empty={{ icon: <BellRing />, title: "Nobody is overdue", description: "Every voucher past its due date has been paid." }}
      />
    </div>
  );
}

function SetupTab() {
  const toast = useToast();
  const heads = useApi<FeeHead[]>("/fees/heads");
  const classes = useApi<SchoolClass[]>("/classes");
  const years = useApi<Year[]>("/academic-years");
  const year = years.data?.find((y) => y.isCurrent) ?? years.data?.[0];
  const structures = useApi<Structure[]>(year ? `/fees/structures?academicYearId=${year.id}` : null);
  const [headError, setHeadError] = useState("");
  const [addingHead, setAddingHead] = useState(false);
  const [headOpen, setHeadOpen] = useState(false);

  async function addHead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const f = new FormData(formEl);
    setAddingHead(true);
    try {
      await api("/fees/heads", { method: "POST", body: { name: f.get("name"), frequency: f.get("frequency") } });
      formEl.reset();
      setHeadError("");
      setHeadOpen(false);
      toast.success("Fee head added");
      await heads.reload();
    } catch (e) {
      setHeadError((e as Error).message);
    } finally {
      setAddingHead(false);
    }
  }

  async function setAmount(classId: string, feeHeadId: string, value: string) {
    if (!year || value === "") return;
    try {
      await api("/fees/structures", {
        method: "PUT",
        body: { classId, feeHeadId, academicYearId: year.id, amount: Number(value) },
      });
      toast.success("Saved");
      await structures.reload();
    } catch (e) {
      toast.error("Could not save the amount", (e as Error).message);
    }
  }

  const amount = (classId: string, feeHeadId: string) =>
    structures.data?.find((s) => s.classId === classId && s.feeHeadId === feeHeadId)?.amount;

  const addHeadButton = (
    <Button size="sm" variant="secondary" icon={<Plus />} onClick={() => setHeadOpen(true)}>
      Add fee head
    </Button>
  );

  const matrixError = classes.error || years.error || structures.error || heads.error;
  const matrixLoading = !classes.data || !years.data || !heads.data || (!!year && !structures.data);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <Card>
        <CardHeader title="Fee heads" description="What a voucher can charge for." action={addHeadButton} />
        {heads.error ? (
          <ErrorState message={heads.error} onRetry={heads.reload} compact />
        ) : !heads.data ? (
          <SkeletonRows rows={4} columns={2} />
        ) : heads.data.length === 0 ? (
          <EmptyState icon={<Wallet />} title="No fee heads yet" description="Add Tuition, Admission or Exam fee to start billing." action={addHeadButton} compact />
        ) : (
          <ul className="-mx-1 divide-y divide-border">
            {heads.data.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 px-1 py-2.5 text-sm">
                <span className="font-medium text-fg">{h.name}</span>
                <Badge tone={h.frequency === "MONTHLY" ? "primary" : "neutral"}>{FREQUENCY_LABEL[h.frequency] ?? h.frequency.toLowerCase().replace("_", " ")}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Dialog
        open={headOpen}
        onOpenChange={(o) => {
          setHeadOpen(o);
          if (o) setHeadError("");
        }}
        title="Add fee head"
        description="Monthly heads appear on every voucher. Annual heads are billed in the first month of the year."
        size="sm"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setHeadOpen(false)} disabled={addingHead}>
              Cancel
            </Button>
            <Button type="submit" form="add-fee-head" loading={addingHead}>
              Add fee head
            </Button>
          </>
        }
      >
        <form id="add-fee-head" onSubmit={addHead} className="flex flex-col gap-4">
          <TextField label="Name" name="name" placeholder="Tuition" required />
          <SelectField
            label="Billed"
            name="frequency"
            options={[
              { value: "MONTHLY", label: "Every month" },
              { value: "ANNUAL", label: "Once a year (first month)" },
              { value: "ONE_TIME", label: "One time" },
            ]}
          />
          {headError && <Alert tone="danger">{headError}</Alert>}
        </form>
      </Dialog>

      <Card padding="none" className="overflow-hidden">
        <div className="p-4 pb-0 sm:p-5 sm:pb-0">
          <CardHeader
            title={`Monthly fee by class${year ? ` (${year.name})` : ""}`}
            description="Amounts in rupees. Changes save when you leave the box."
          />
        </div>
        {matrixError ? (
          <ErrorState
            message={matrixError}
            onRetry={() => {
              void heads.reload();
              void classes.reload();
              void years.reload();
              void structures.reload();
            }}
            compact
          />
        ) : years.data && !year ? (
          <EmptyState title="No academic year yet" description="Add an academic year on the Classes page first." action={<Link className="text-sm font-medium text-brand hover:underline" href="/classes">Go to Classes</Link>} compact />
        ) : matrixLoading ? (
          <div className="p-4 sm:p-5">
            <SkeletonRows rows={5} columns={4} />
          </div>
        ) : classes.data!.length === 0 || heads.data!.length === 0 ? (
          <EmptyState
            title={classes.data!.length === 0 ? "No classes yet" : "No fee heads yet"}
            description={classes.data!.length === 0 ? "Add classes on the Classes page to set their fees." : "Add a fee head to set what each class pays."}
            compact
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-sm">
              <thead className="bg-surface-2">
                <tr className="border-y border-border">
                  <th scope="col" className="px-4 py-2.5 text-start text-xs font-medium uppercase tracking-[0.04em] text-fg-muted">
                    Class
                  </th>
                  {heads.data!.map((h) => (
                    <th key={h.id} scope="col" className="px-3 py-2.5 text-end text-xs font-medium uppercase tracking-[0.04em] text-fg-muted">
                      {h.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {classes.data!.map((c) => (
                  <tr key={c.id} className="transition-colors even:bg-surface-2/60 hover:bg-surface-3/70">
                    <th scope="row" className="px-4 py-2 text-start font-medium text-fg">
                      {c.name} <span className="ms-1 text-xs font-normal text-fg-muted">{c.campus.name}</span>
                    </th>
                    {heads.data!.map((h) => (
                      <td key={h.id} className="px-3 py-1.5 text-end">
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          aria-label={`${h.name} for ${c.name}, rupees`}
                          placeholder="0"
                          defaultValue={amount(c.id, h.id)}
                          key={`${c.id}-${h.id}-${amount(c.id, h.id) ?? ""}`}
                          onBlur={(e) => e.target.value !== String(amount(c.id, h.id) ?? "") && setAmount(c.id, h.id, e.target.value)}
                          className={cn(inputClass, "h-8 w-28 text-end tabular-nums")}
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
