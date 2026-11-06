"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Ban, Banknote, FilePlus, FileText, Receipt } from "lucide-react";
import {
  Alert,
  Button,
  DataTable,
  Dialog,
  NativeSelect,
  PageHeader,
  SelectField,
  TextField,
  Tooltip,
  useToast,
  type Column,
} from "@/components/ui";
import { BillStatePill } from "@/components/billing/platform-documents";
import { ReasonDialog } from "@/components/platform/reason-dialog";
import { isOwner, useConsoleAdmin } from "@/components/platform/session";
import { platformApi } from "@/lib/api";
import { day, rupees, thisMonth, todayIso } from "@/lib/format";
import { billOwed, PAYMENT_METHODS, totalOwed, type PlatformBill } from "@/lib/platform-billing";
import { usePlatformApi } from "@/lib/use-api";
import { monthName } from "../status";

type Bill = PlatformBill & { school: { id: string; name: string } };

const METHOD_OPTIONS = PAYMENT_METHODS.map((m) => ({ value: m, label: m }));
const BILL_STATUSES = [
  { value: "UNPAID", label: "Unpaid" },
  { value: "PAID", label: "Paid" },
  { value: "VOID", label: "Void" },
];

export default function BillsPage() {
  const toast = useToast();
  const canVoid = isOwner(useConsoleAdmin());
  // Links from the overview pass ?status=... (the console only renders in the browser).
  const [status, setStatus] = useState(() => new URLSearchParams(window.location.search).get("status") ?? "");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize), ...(status && { status }), ...(search.trim() && { search: search.trim() }) });
  const bills = usePlatformApi<{ items: Bill[]; total: number }>(`/invoices?${query}`);

  const [generateOpen, setGenerateOpen] = useState(false);
  const [period, setPeriod] = useState(thisMonth());
  const [paying, setPaying] = useState<Bill | null>(null);
  const [method, setMethod] = useState<string>(PAYMENT_METHODS[0]);
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(todayIso());
  const [voiding, setVoiding] = useState<Bill | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState("");

  /** Runs a change, shows its message as a toast and reloads the list. Returns the error message, or "" on success. */
  async function run(action: () => Promise<string>) {
    setDialogError("");
    setBusy(true);
    try {
      const message = await action();
      if (message) toast.success(message);
      await bills.reload();
      return "";
    } catch (e) {
      const message = (e as Error).message;
      setDialogError(message);
      return message;
    } finally {
      setBusy(false);
    }
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    const failed = await run(async () => {
      const res = await platformApi<{ created: number; total: number }>("/invoices/generate", { method: "POST", body: { period } });
      return res.created
        ? `Billed ${res.created} ${res.created === 1 ? "school" : "schools"} ${rupees(res.total)} for ${monthName(period)}.`
        : `Every paying school already has a bill for ${monthName(period)}.`;
    });
    if (!failed) setGenerateOpen(false);
  }

  async function pay(event: FormEvent) {
    event.preventDefault();
    const bill = paying;
    if (!bill) return;
    const failed = await run(async () => {
      await platformApi(`/invoices/${bill.id}/pay`, {
        method: "POST",
        body: { method, reference: reference.trim() || undefined, paidAt: paidOn || undefined },
      });
      return `${rupees(billOwed(bill))} from ${bill.school.name} recorded; ${bill.number} is paid.`;
    });
    if (!failed) {
      setPaying(null);
      setReference("");
    }
  }

  async function voidBill(reason: string) {
    const bill = voiding;
    if (!bill) return;
    await platformApi(`/invoices/${bill.id}/void`, { method: "POST", body: { reason } });
    toast.success(`${bill.number} voided.`);
    await bills.reload();
  }

  function openPay(b: Bill) {
    setDialogError("");
    setMethod(PAYMENT_METHODS[0]);
    setReference("");
    setPaidOn(todayIso());
    setPaying(b);
  }

  const unpaidShown = bills.data?.items.filter((b) => b.status === "UNPAID") ?? [];
  const unpaidTotal = totalOwed(unpaidShown);

  const columns: Column<Bill>[] = [
    { id: "number", header: "Bill", sortValue: (b) => b.number, cell: (b) => <span className="font-mono text-xs">{b.number}</span> },
    {
      id: "school",
      header: "School",
      sortValue: (b) => b.school.name,
      cell: (b) => (
        <Link href={`/platform/schools/${b.school.id}`} className="font-medium text-fg hover:text-brand">
          {b.school.name}
        </Link>
      ),
    },
    { id: "period", header: "Month", sortValue: (b) => b.period, cell: (b) => monthName(b.period) },
    { id: "plan", header: "Plan", sortValue: (b) => b.planName, cell: (b) => b.planName, hideBelow: "lg" },
    { id: "students", header: "Students", align: "right", sortValue: (b) => b.students, cell: (b) => b.students, hideBelow: "md" },
    {
      id: "amount",
      header: "Amount",
      align: "right",
      sortValue: (b) => b.amount,
      cell: (b) => (b.status === "VOID" ? <span className="text-fg-muted line-through">{rupees(b.amount)}</span> : rupees(b.amount)),
    },
    {
      id: "paid",
      header: "Paid so far",
      align: "right",
      sortValue: (b) => b.amountPaid,
      cell: (b) => (b.amountPaid ? rupees(b.amountPaid) : <span className="text-fg-muted">–</span>),
      hideBelow: "md",
    },
    {
      id: "owed",
      header: "Still owed",
      align: "right",
      sortValue: (b) => billOwed(b),
      cell: (b) => (billOwed(b) ? <span className="font-medium text-fg">{rupees(billOwed(b))}</span> : <span className="text-fg-muted">–</span>),
    },
    { id: "due", header: "Due", sortValue: (b) => b.dueDate, cell: (b) => day(b.dueDate), hideBelow: "md" },
    {
      id: "status",
      header: "Status",
      sortValue: (b) => b.status,
      cell: (b) => (
        <span className="flex max-w-56 flex-col items-start gap-0.5">
          <BillStatePill bill={b} />
          {b.paidAt && (
            <span className="text-xs text-fg-muted">
              {day(b.paidAt)}, {b.method}
            </span>
          )}
          {b.status === "VOID" && b.voidReason && <span className="text-xs text-fg-muted">{b.voidReason}</span>}
        </span>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (b) => (
        <span className="flex justify-end gap-1.5 whitespace-nowrap">
          <Link
            href={`/platform/bills/${b.id}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-fg-secondary hover:bg-surface-3 hover:text-fg [&_svg]:size-4"
            aria-label={`View or print ${b.number}`}
          >
            <FileText aria-hidden />
            View
          </Link>
          {b.status === "UNPAID" && (
            <>
              <Button
                size="sm"
                variant="secondary"
                type="button"
                icon={<Banknote />}
                onClick={() => openPay(b)}
                aria-label={`Record payment for ${b.number}`}
              >
                Record payment
              </Button>
              <Tooltip content="Only a SchoolSyncer owner can void a bill" disabled={canVoid}>
                {/* A disabled button gets no hover, so the wrapper carries the tooltip. */}
                <span tabIndex={canVoid ? undefined : 0}>
                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    icon={<Ban />}
                    disabled={!canVoid}
                    onClick={() => setVoiding(b)}
                    aria-label={`Void ${b.number}`}
                  >
                    Void
                  </Button>
                </span>
              </Tooltip>
            </>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Bills"
        description="Monthly bills for every paying school. A bill stays unpaid until it is paid in full; part-paid bills show what is still owed."
        actions={
          <Button
            icon={<FilePlus />}
            onClick={() => {
              setDialogError("");
              setGenerateOpen(true);
            }}
          >
            Create bills
          </Button>
        }
      />

      {unpaidTotal > 0 && (
        <Alert tone="warning" title={`${rupees(unpaidTotal)} unpaid on this page`}>
          {unpaidShown.length} {unpaidShown.length === 1 ? "bill is" : "bills are"} waiting for payment.
        </Alert>
      )}

      <DataTable
        label="Bills"
        columns={columns}
        data={bills.data?.items}
        getRowId={(b) => b.id}
        error={bills.error}
        onRetry={bills.reload}
        search={search}
        onSearchChange={(v) => (setSearch(v), setPage(1))}
        manualFiltering
        serverPagination={{
          page,
          pageSize,
          total: bills.data?.total ?? 0,
          onPageChange: setPage,
          onPageSizeChange: (n) => (setPageSize(n), setPage(1)),
        }}
        searchPlaceholder="Search bill number or school"
        filters={
          <NativeSelect
            aria-label="Status"
            placeholder="All bills"
            options={BILL_STATUSES}
            value={status}
            onChange={(e) => (setStatus(e.target.value), setPage(1))}
            wrapperClassName="w-36"
          />
        }
        filtered={!!status || !!search}
        empty={{
          icon: <Receipt />,
          title: "No bills",
          description: "Create bills for a month to bill every paying school.",
          action: (
            <Button type="button" icon={<FilePlus />} onClick={() => setGenerateOpen(true)}>
              Create bills
            </Button>
          ),
        }}
      />

      <Dialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        title="Bill paying schools for a month"
        description="Each active or past-due school is billed at its current number of active students. Schools on trial are skipped, and running it twice for the same month does nothing."
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setGenerateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="generate-bills" loading={busy}>
              Create bills
            </Button>
          </>
        }
      >
        <form id="generate-bills" onSubmit={generate} className="flex flex-col gap-4">
          <TextField label="Month" type="month" required value={period} onChange={(e) => setPeriod(e.target.value)} />
          {dialogError && <Alert tone="danger">{dialogError}</Alert>}
        </form>
      </Dialog>

      <Dialog
        open={!!paying}
        onOpenChange={(open) => !open && setPaying(null)}
        title={paying ? `Record payment for ${paying.number}` : "Record payment"}
        description={
          paying
            ? `${paying.school.name} pays the ${rupees(billOwed(paying))} still owed on the ${monthName(paying.period)} bill${paying.amountPaid ? ` (${rupees(paying.amountPaid)} of ${rupees(paying.amount)} already paid)` : ""}. To record a different amount, use Record payment on the school's Billing tab.`
            : undefined
        }
        size="sm"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setPaying(null)}>
              Cancel
            </Button>
            <Button type="submit" form="pay-bill" loading={busy} icon={<Banknote />}>
              Record {paying ? rupees(billOwed(paying)) : "payment"}
            </Button>
          </>
        }
      >
        <form id="pay-bill" onSubmit={pay} className="flex flex-col gap-4">
          <SelectField label="Method" options={METHOD_OPTIONS} value={method} onChange={(e) => setMethod(e.target.value)} />
          <TextField label="Received on" type="date" required max={todayIso()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          <TextField
            label="Reference"
            hint="Optional, for example the bank transaction ID."
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
          {dialogError && <Alert tone="danger">{dialogError}</Alert>}
        </form>
      </Dialog>

      <ReasonDialog
        open={!!voiding}
        onOpenChange={(open) => !open && setVoiding(null)}
        title={voiding ? `Void ${voiding.number}?` : "Void bill?"}
        description={
          voiding
            ? `${voiding.school.name} will no longer owe ${rupees(billOwed(voiding))} for this bill.${voiding.amountPaid ? ` The ${rupees(voiding.amountPaid)} already paid towards it becomes credit for their next bill.` : ""}`
            : ""
        }
        confirmLabel="Void bill"
        destructive
        reasonLabel="Why is this bill being voided?"
        placeholder="Billed twice for September; the school asked by phone"
        onSubmit={voidBill}
      />
    </div>
  );
}
