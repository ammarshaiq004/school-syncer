"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Ban, CircleCheck, FilePlus, Receipt } from "lucide-react";
import {
  Alert,
  Button,
  ConfirmDialog,
  DataTable,
  Dialog,
  NativeSelect,
  PageHeader,
  SelectField,
  TextField,
  useToast,
  type Column,
} from "@/components/ui";
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
const BILL_STATUSES = [
  { value: "UNPAID", label: "Unpaid" },
  { value: "PAID", label: "Paid" },
  { value: "VOID", label: "Void" },
];

export default function BillsPage() {
  const toast = useToast();
  // Links from the overview pass ?status=... (the console only renders in the browser).
  const [status, setStatus] = useState(() => new URLSearchParams(window.location.search).get("status") ?? "");
  const bills = usePlatformApi<Bill[]>(`/invoices${status ? `?status=${status}` : ""}`);

  const [generateOpen, setGenerateOpen] = useState(false);
  const [period, setPeriod] = useState(thisMonth());
  const [paying, setPaying] = useState<Bill | null>(null);
  const [method, setMethod] = useState(METHODS[0]);
  const [reference, setReference] = useState("");
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
      await platformApi(`/invoices/${bill.id}/pay`, { method: "POST", body: { method, reference: reference || undefined } });
      return `${bill.number} from ${bill.school.name} marked paid.`;
    });
    if (!failed) {
      setPaying(null);
      setReference("");
    }
  }

  async function voidBill() {
    const bill = voiding;
    if (!bill) return;
    const failed = await run(async () => {
      await platformApi(`/invoices/${bill.id}/void`, { method: "POST" });
      return `${bill.number} voided.`;
    });
    if (failed) toast.error("Could not void the bill", failed);
    else setVoiding(null);
  }

  function openPay(b: Bill) {
    setDialogError("");
    setMethod(METHODS[0]);
    setReference("");
    setPaying(b);
  }

  const unpaidShown = bills.data?.filter((b) => b.status === "UNPAID") ?? [];
  const unpaidTotal = unpaidShown.reduce((a, b) => a + b.amount, 0);

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
    { id: "amount", header: "Amount", align: "right", sortValue: (b) => b.amount, cell: (b) => rupees(b.amount) },
    { id: "due", header: "Due", sortValue: (b) => b.dueDate, cell: (b) => day(b.dueDate), hideBelow: "md" },
    {
      id: "status",
      header: "Status",
      sortValue: (b) => b.status,
      cell: (b) => (
        <span className="flex flex-col items-start gap-0.5">
          <StatusBadge status={b.status} />
          {b.paidAt && (
            <span className="text-xs text-fg-muted">
              {day(b.paidAt)}, {b.method}
            </span>
          )}
        </span>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (b) =>
        b.status === "UNPAID" ? (
          <span className="flex justify-end gap-1.5 whitespace-nowrap">
            <Button size="sm" variant="secondary" type="button" icon={<CircleCheck />} onClick={() => openPay(b)} aria-label={`Mark ${b.number} paid`}>
              Mark paid
            </Button>
            <Button size="sm" variant="ghost" type="button" icon={<Ban />} onClick={() => setVoiding(b)} aria-label={`Void ${b.number}`}>
              Void
            </Button>
          </span>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Bills"
        description="Monthly bills for every paying school. Record payments and void bills here."
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
        <Alert tone="warning" title={`${rupees(unpaidTotal)} unpaid in this list`}>
          {unpaidShown.length} {unpaidShown.length === 1 ? "bill is" : "bills are"} waiting for payment.
        </Alert>
      )}

      <DataTable
        label="Bills"
        columns={columns}
        data={bills.data}
        getRowId={(b) => b.id}
        error={bills.error}
        onRetry={bills.reload}
        getSearchText={(b) => `${b.number} ${b.school.name} ${b.planName}`}
        searchPlaceholder="Search bill number or school"
        filters={
          <NativeSelect
            aria-label="Status"
            placeholder="All bills"
            options={BILL_STATUSES}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            wrapperClassName="w-36"
          />
        }
        filtered={!!status}
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
        description={paying ? `${paying.school.name}, ${rupees(paying.amount)} for ${monthName(paying.period)}` : undefined}
        size="sm"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setPaying(null)}>
              Cancel
            </Button>
            <Button type="submit" form="pay-bill" loading={busy}>
              Mark paid
            </Button>
          </>
        }
      >
        <form id="pay-bill" onSubmit={pay} className="flex flex-col gap-4">
          <SelectField label="Method" options={METHODS.map((m) => ({ value: m, label: m }))} value={method} onChange={(e) => setMethod(e.target.value)} />
          <TextField
            label="Reference"
            hint="Optional, for example the bank transaction ID."
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
          {dialogError && <Alert tone="danger">{dialogError}</Alert>}
        </form>
      </Dialog>

      <ConfirmDialog
        open={!!voiding}
        onOpenChange={(open) => !open && setVoiding(null)}
        title={voiding ? `Void ${voiding.number}?` : "Void bill?"}
        description={voiding ? `${voiding.school.name} will no longer owe ${rupees(voiding.amount)} for this bill.` : ""}
        confirmLabel="Void bill"
        destructive
        loading={busy}
        onConfirm={voidBill}
      />
    </div>
  );
}
