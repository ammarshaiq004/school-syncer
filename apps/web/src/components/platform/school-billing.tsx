"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Banknote, CalendarPlus, PiggyBank, Receipt, Wallet } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  DataTable,
  Dialog,
  KpiCard,
  SelectField,
  StatGrid,
  TextareaField,
  TextField,
  useToast,
  type Column,
} from "@/components/ui";
import { BillStatePill } from "@/components/billing/platform-documents";
import { platformApi } from "@/lib/api";
import { cn } from "@/lib/cn";
import { day, rupees, todayIso } from "@/lib/format";
import { PAYMENT_METHODS, type PlatformBill, type PlatformPayment } from "@/lib/platform-billing";
import { usePlatformApi } from "@/lib/use-api";

/** GET /platform/schools/:id/statement. Entries are newest first; a positive balance is owed. */
interface Statement {
  outstanding: number;
  credit: number;
  balance: number;
  invoices: PlatformBill[];
  payments: PlatformPayment[];
  entries: Entry[];
}

interface Entry {
  date: string;
  kind: "bill" | "payment";
  id: string;
  number: string;
  description: string;
  charge: number;
  credit: number;
  balance: number;
  void: boolean;
}

const METHOD_OPTIONS = PAYMENT_METHODS.map((m) => ({ value: m, label: m }));

function balanceText(balance: number) {
  if (balance > 0) return rupees(balance);
  if (balance < 0) return `${rupees(-balance)} credit`;
  return rupees(0);
}

/**
 * A school's account with SchoolSyncer on its detail page: what it still owes,
 * its credit, every bill and payment with the running balance, and buttons to
 * record a payment or bill this month straight away.
 */
export function SchoolBilling({ schoolId, schoolName, onChanged }: { schoolId: string; schoolName: string; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const statement = usePlatformApi<Statement>(`/schools/${schoolId}/statement`);
  const [paying, setPaying] = useState(false);
  const [billing, setBilling] = useState(false);
  const st = statement.data;
  const bills = new Map(st?.invoices.map((i) => [i.id, i]));
  const payments = new Map(st?.payments.map((p) => [p.id, p]));

  async function refresh() {
    await Promise.all([statement.reload(), onChanged()]);
  }

  async function billNow() {
    setBilling(true);
    try {
      const bill = await platformApi<PlatformBill>(`/schools/${schoolId}/bill-now`, { method: "POST" });
      toast.success(`Bill ${bill.number} issued`, `${rupees(bill.amount)} for ${bill.students} students. The owners have been told.`);
      await refresh();
    } catch (e) {
      // 409 explains why there is nothing to bill (already billed, on trial...).
      toast.error("No bill issued", (e as Error).message);
    } finally {
      setBilling(false);
    }
  }

  const columns: Column<Entry>[] = [
    { id: "date", header: "Date", cell: (e) => <span className="whitespace-nowrap">{day(e.date)}</span> },
    {
      id: "description",
      header: "Description",
      cell: (e) => {
        const bill = e.kind === "bill" ? bills.get(e.id) : undefined;
        const payment = e.kind === "payment" ? payments.get(e.id) : undefined;
        const reason = bill?.voidReason ?? payment?.voidReason;
        return (
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className={cn("text-fg", e.void && "text-fg-muted line-through")}>{e.description}</span>
            <span className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              <Link
                href={e.kind === "bill" ? `/platform/bills/${e.id}` : `/platform/receipts/${e.id}`}
                className="font-mono hover:text-brand"
              >
                {e.number}
              </Link>
              {bill && <BillStatePill bill={bill} />}
              {e.void && <span>Void{reason ? `: ${reason}` : ""}</span>}
            </span>
          </span>
        );
      },
    },
    {
      id: "charge",
      header: "Charge",
      align: "right",
      cell: (e) => {
        const original = e.kind === "bill" ? bills.get(e.id)?.amount : undefined;
        if (e.void && original) return <span className="text-fg-muted line-through">{rupees(original)}</span>;
        return e.charge ? rupees(e.charge) : <span className="text-fg-muted">–</span>;
      },
    },
    {
      id: "payment",
      header: "Payment",
      align: "right",
      cell: (e) => {
        const original = e.kind === "payment" ? payments.get(e.id)?.amount : undefined;
        if (e.void && original) return <span className="text-fg-muted line-through">{rupees(original)}</span>;
        return e.credit ? <span className="text-success-text">{rupees(e.credit)}</span> : <span className="text-fg-muted">–</span>;
      },
    },
    {
      id: "balance",
      header: "Balance",
      align: "right",
      cell: (e) => <span className={cn("whitespace-nowrap font-medium", e.balance < 0 ? "text-success-text" : "text-fg")}>{balanceText(e.balance)}</span>,
      hideBelow: "sm",
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <StatGrid cols={3}>
        <KpiCard
          label="Still owed"
          value={st ? rupees(st.outstanding) : "–"}
          icon={<Wallet />}
          tone={st && st.outstanding > 0 ? "danger" : "success"}
          loading={!st && !statement.error}
          error={!!statement.error}
        />
        <KpiCard
          label="Credit for the next bill"
          value={st ? rupees(st.credit) : "–"}
          icon={<PiggyBank />}
          tone="info"
          loading={!st && !statement.error}
          error={!!statement.error}
        />
        <KpiCard
          label="Bills"
          value={st ? st.invoices.filter((i) => i.status !== "VOID").length.toLocaleString("en-PK") : "–"}
          hint={st ? `${st.payments.filter((p) => p.status === "RECORDED").length} payments received` : undefined}
          icon={<Receipt />}
          tone="neutral"
          loading={!st && !statement.error}
          error={!!statement.error}
        />
      </StatGrid>

      <Card padding="none" className="overflow-hidden">
        <div className="p-4 pb-0 sm:p-5 sm:pb-0">
          <CardHeader
            title="Statement"
            description="Bills and payments, newest first, with the balance after each. Payments go to the oldest unpaid bill first."
            action={
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" size="sm" icon={<CalendarPlus />} loading={billing} onClick={billNow}>
                  Bill this month now
                </Button>
                <Button type="button" size="sm" icon={<Banknote />} onClick={() => setPaying(true)}>
                  Record payment
                </Button>
              </div>
            }
          />
        </div>
        <DataTable
          bare
          label={`Statement for ${schoolName}`}
          columns={columns}
          data={st?.entries}
          getRowId={(e) => `${e.kind}:${e.id}`}
          error={statement.error}
          onRetry={statement.reload}
          pageSize={15}
          empty={{ icon: <Receipt />, title: "No bills or payments yet", description: "Bills appear once this school is billed for a month." }}
        />
      </Card>

      <RecordPaymentDialog
        open={paying}
        onOpenChange={setPaying}
        schoolId={schoolId}
        schoolName={schoolName}
        outstanding={st?.outstanding ?? 0}
        onRecorded={async (message) => {
          toast.success("Payment recorded", message);
          await refresh();
        }}
      />
    </div>
  );
}

function RecordPaymentDialog({
  open,
  onOpenChange,
  schoolId,
  schoolName,
  outstanding,
  onRecorded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schoolId: string;
  schoolName: string;
  outstanding: number;
  onRecorded: (message: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const f = new FormData(formEl);
    const amount = Number(f.get("amount"));
    setBusy(true);
    setError("");
    try {
      const payment = await platformApi<PlatformPayment>(`/schools/${schoolId}/payments`, {
        method: "POST",
        body: {
          amount,
          method: f.get("method"),
          reference: String(f.get("reference") ?? "").trim() || undefined,
          receivedOn: f.get("receivedOn") || undefined,
          note: String(f.get("note") ?? "").trim() || undefined,
        },
      });
      formEl.reset();
      onOpenChange(false);
      const extra = amount > outstanding ? ` ${rupees(amount - outstanding)} is kept as credit for the next bill.` : "";
      await onRecorded(`Receipt ${payment.number} for ${rupees(payment.amount)}.${extra}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return;
        onOpenChange(o);
        if (!o) setError("");
      }}
      title={`Record a payment from ${schoolName}`}
      description={
        outstanding > 0
          ? `${rupees(outstanding)} is still owed. The payment goes to the oldest unpaid bill first; anything over is kept as credit.`
          : "Nothing is owed right now, so this payment is kept as credit for the next bill."
      }
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="record-platform-payment" loading={busy} icon={<Banknote />}>
            Record payment
          </Button>
        </>
      }
    >
      <form id="record-platform-payment" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Amount (Rs)"
          name="amount"
          type="number"
          min={1}
          max={100_000_000}
          step={1}
          required
          inputMode="numeric"
          defaultValue={outstanding > 0 ? outstanding : undefined}
        />
        <SelectField label="Method" name="method" options={METHOD_OPTIONS} defaultValue={PAYMENT_METHODS[0]} />
        <TextField label="Reference" name="reference" maxLength={60} hint="Bank or wallet transaction ID, cheque number" />
        <TextField label="Received on" name="receivedOn" type="date" required max={todayIso()} defaultValue={todayIso()} />
        <TextareaField label="Note (staff only)" name="note" rows={2} maxLength={300} wrapperClassName="sm:col-span-2" />
        {error && (
          <Alert tone="danger" className="sm:col-span-2">
            {error}
          </Alert>
        )}
      </form>
    </Dialog>
  );
}
