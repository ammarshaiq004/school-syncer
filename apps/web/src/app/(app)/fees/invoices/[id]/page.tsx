"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Ban, Banknote, CalendarClock, CalendarX2, Download, Forward, Printer, ReceiptText, SlidersHorizontal, TriangleAlert, Undo2 } from "lucide-react";
import { InvoiceStatusPill, invoiceDisplay } from "@/components/fees/invoice-status";
import { ReasonDialog } from "@/components/fees/reason-dialog";
import { InvoiceBreakdownCard, PrintableVoucher } from "@/components/invoices/invoice-breakdown";
import {
  Alert,
  Avatar,
  Button,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  ErrorState,
  PageHeader,
  SelectField,
  Skeleton,
  SkeletonRows,
  TextField,
  useToast,
} from "@/components/ui";
import { api } from "@/lib/api";
import { day, fullName, rupees } from "@/lib/format";
import { can, useSession } from "@/lib/session";
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
  cancelledAt: string | null;
  cancelReason: string | null;
  kind: "MONTHLY" | "ADHOC";
  /** Late fine already added to the total as a line. */
  fineBooked: number;
  fineWaivedAt: string | null;
  fineWaiverReason: string | null;
  carriedTo: VoucherRef | null;
  carriedFrom: VoucherRef[];
  school: { name: string; city: string | null; phone: string | null };
  lines: { id: string; description: string; amount: number }[];
  payments: Payment[];
  student: {
    firstName: string;
    lastName: string | null;
    admissionNo: string;
    enrollments: { section: { name: string; class: { name: string } } }[];
    guardians: { guardian: { name: string } }[];
  };
}
interface VoucherRef {
  id: string;
  voucherNo: string;
  period: string;
}
interface Payment {
  id: string;
  amount: number;
  method: string;
  receiptNo: string;
  reference: string | null;
  receivedAt: string;
  reversedAt: string | null;
  reversalReason: string | null;
}

const METHODS = ["CASH", "BANK", "JAZZCASH", "EASYPAISA", "ONEBILL", "CARD"];
const METHOD_LABEL: Record<string, string> = {
  CASH: "Cash",
  BANK: "Bank",
  JAZZCASH: "JazzCash",
  EASYPAISA: "Easypaisa",
  ONEBILL: "1Bill",
  CARD: "Card",
};
const methodLabel = (m: string) => METHOD_LABEL[m] ?? m.toLowerCase();

const monthLabel = (period: string) =>
  /^\d{4}-\d{2}$/.test(period)
    ? new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
    : period;

export default function VoucherPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const user = useSession();
  const canManage = can(user, "fees", "manage") && user.plan?.access !== "read_only";
  const voucher = useApi<Voucher>(`/fees/invoices/${id}`);
  const [payOpen, setPayOpen] = useState(false);
  // One key per opening of the payment dialog, so a retried save is recorded once.
  const [payKey, setPayKey] = useState("");
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");
  const [voidOpen, setVoidOpen] = useState(false);
  const [reversing, setReversing] = useState<Payment | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [waiveOpen, setWaiveOpen] = useState(false);
  const v = voucher.data;

  function openPay() {
    setError("");
    // randomUUID needs a secure context; plain-http deployments fall back to a random string.
    setPayKey(crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    setPayOpen(true);
  }

  async function voidVoucher(reason: string) {
    await api(`/fees/invoices/${id}/cancel`, { method: "POST", body: { reason } });
    toast.success("Voucher voided", "It no longer counts towards the student's balance.");
    await voucher.reload();
  }

  async function waiveFine(reason: string) {
    const res = await api<{ waived: number }>(`/fees/invoices/${id}/waive-fine`, { method: "POST", body: { reason } });
    toast.success("Late fine waived", res.waived ? `${rupees(res.waived)} came off the voucher.` : "No more fine will build up on this voucher.");
    await voucher.reload();
  }

  async function reverse(reason: string) {
    if (!reversing) return;
    await api(`/fees/payments/${reversing.id}/reverse`, { method: "POST", body: { reason } });
    toast.success("Payment reversed", `Receipt ${reversing.receiptNo} no longer counts.`);
    await voucher.reload();
  }

  async function pay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const f = new FormData(formEl);
    setPaying(true);
    try {
      const res = await api<{ payment: { receiptNo: string } }>(`/fees/invoices/${id}/payments`, {
        method: "POST",
        body: {
          amount: Number(f.get("amount")),
          method: f.get("method"),
          reference: f.get("reference") || undefined,
          idempotencyKey: payKey || undefined,
        },
      });
      toast.success("Payment recorded", `Receipt ${res.payment.receiptNo}.`);
      setError("");
      formEl.reset();
      setPayOpen(false);
      await voucher.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPaying(false);
    }
  }

  if (!v) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Voucher" breadcrumbs={[{ label: "Fees", href: "/fees" }, { label: "Voucher" }]} />
        {voucher.error ? (
          <Card padding="none">
            <ErrorState message={voucher.error} onRetry={voucher.reload} />
          </Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3" aria-busy="true" aria-label="Loading voucher">
            <Card className="lg:col-span-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="mt-3 h-4 w-64" />
              <SkeletonRows rows={5} columns={2} className="mt-6" />
            </Card>
            <Card>
              <SkeletonRows rows={3} columns={2} />
            </Card>
          </div>
        )}
      </div>
    );
  }

  const cls = v.student.enrollments[0];
  const className = cls ? `${cls.section.class.name} ${cls.section.name}` : "Not enrolled";
  const guardian = v.student.guardians[0]?.guardian.name;
  const open = v.status === "UNPAID" || v.status === "PARTIAL";
  const canPay = open;
  const display = invoiceDisplay(v);
  const live = v.payments.filter((p) => !p.reversedAt);
  const reversedCount = v.payments.length - live.length;
  // Only a voucher with no money standing on it can be voided; reverse its payments first.
  const canVoid = canManage && v.status !== "CANCELLED" && v.status !== "CARRIED_FORWARD" && live.length === 0;
  const canAdjust = canManage && v.status !== "CANCELLED" && v.status !== "CARRIED_FORWARD";
  // A fine is waived once; booked fine still unpaid comes off the voucher.
  const canWaive = canManage && open && !v.fineWaivedAt && (v.lateFine > 0 || v.fineBooked > 0);

  const payButton = canPay ? (
    <Button icon={<Banknote />} onClick={openPay}>
      Record payment
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Voucher ${v.voucherNo}`}
        description={`${fullName(v.student)}, ${v.kind === "ADHOC" ? `one-off voucher issued ${day(v.issueDate)}` : monthLabel(v.period)}`}
        breadcrumbs={[{ label: "Fees", href: "/fees" }, { label: v.voucherNo }]}
        leading={<Avatar name={fullName(v.student)} size="lg" />}
        meta={
          <>
            <InvoiceStatusPill invoice={v} />
            <span className="text-[13px] text-fg-muted">Due {day(v.dueDate)}</span>
          </>
        }
        actions={
          <>
            {canVoid && (
              <Button variant="secondary" icon={<Ban />} onClick={() => setVoidOpen(true)}>
                Void voucher
              </Button>
            )}
            {canAdjust && (
              <Button variant="secondary" icon={<SlidersHorizontal />} onClick={() => setAdjustOpen(true)}>
                Adjust
              </Button>
            )}
            {canWaive && (
              <Button variant="secondary" icon={<CalendarX2 />} onClick={() => setWaiveOpen(true)}>
                Waive late fine
              </Button>
            )}
            <Button variant={canPay ? "secondary" : "primary"} icon={<Download />} onClick={() => window.print()}>
              Download invoice PDF
            </Button>
            {payButton}
          </>
        }
      />

      {display === "OVERDUE" && (
        <Alert tone="danger" title="This voucher is overdue" className="print:hidden" icon={<TriangleAlert />}>
          {rupees(v.balance)} was due on {day(v.dueDate)}.
          {v.lateFine > 0 && ` A late fine of ${rupees(v.lateFine)} has built up so far; it is added to the voucher when a payment is taken.`}
        </Alert>
      )}
      {v.carriedTo && (
        <Alert tone="info" title="Balance carried forward" className="print:hidden" icon={<Forward />}>
          What was still owed here moved onto voucher{" "}
          <Link className="font-medium underline" href={`/fees/invoices/${v.carriedTo.id}`}>
            {v.carriedTo.voucherNo}
          </Link>{" "}
          ({monthLabel(v.carriedTo.period)}), so take payments and make corrections there. Voiding that voucher brings the balance back here.
        </Alert>
      )}
      {v.carriedFrom.length > 0 && (
        <Alert tone="info" title="Includes arrears" className="print:hidden">
          The unpaid balance of{" "}
          {v.carriedFrom.map((c, i) => (
            <span key={c.id}>
              {i > 0 && ", "}
              <Link className="font-medium underline" href={`/fees/invoices/${c.id}`}>
                {c.voucherNo}
              </Link>
            </span>
          ))}{" "}
          is part of this voucher&apos;s total.
        </Alert>
      )}
      {v.fineWaivedAt && (
        <Alert tone="neutral" title={`Late fine waived on ${day(v.fineWaivedAt)}`} className="print:hidden">
          {v.fineWaiverReason ? `${v.fineWaiverReason}. ` : ""}No late fine builds up on this voucher.
        </Alert>
      )}
      {v.status === "CANCELLED" && (
        <Alert
          tone="neutral"
          title={v.cancelledAt ? `This voucher was voided on ${day(v.cancelledAt)}` : "This voucher was cancelled"}
          className="print:hidden"
        >
          {v.cancelReason ? `${v.cancelReason}. ` : ""}It no longer counts towards the student&apos;s balance and cannot take payments.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3 print:hidden">
        {/* Breakdown */}
        <InvoiceBreakdownCard
          className="lg:col-span-2"
          voucherNo={v.voucherNo}
          school={v.school}
          details={[
            { label: "Student", value: fullName(v.student) },
            { label: "Admission no.", value: v.student.admissionNo },
            { label: "Class", value: className },
            { label: "Guardian", value: guardian ?? "Not added" },
            { label: "Issued", value: day(v.issueDate) },
            { label: "Due date", value: day(v.dueDate) },
          ]}
          lines={v.lines}
          total={v.total}
          paid={v.paid}
          balance={v.balance}
          lateFine={v.lateFine}
        />

        {/* Payments */}
        <Card className="self-start">
          <CardHeader
            title="Payments"
            description={`${live.length} received${reversedCount ? `, ${reversedCount} reversed` : ""}`}
            icon={<ReceiptText />}
          />
          {v.payments.length === 0 ? (
            <EmptyState
              icon={<Banknote />}
              title="No payments yet"
              description={canPay ? "Record a payment taken at the counter, by bank or by wallet." : undefined}
              action={payButton}
              compact
            />
          ) : (
            <ul className="-mx-1 divide-y divide-border">
              {v.payments.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-3 px-1 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-fg">{methodLabel(p.method)}</div>
                    <div className="text-xs text-fg-muted">
                      {day(p.receivedAt)}
                      {p.reference ? `, ref ${p.reference}` : ""}
                    </div>
                    <Link className="mt-0.5 block font-mono text-[11px] text-fg-muted hover:text-brand" href={`/fees/receipts/${p.id}`}>
                      {p.receiptNo} <span className="font-sans">(receipt)</span>
                    </Link>
                    {p.reversedAt && (
                      <div className="mt-1 text-xs text-danger-text">
                        Reversed {day(p.reversedAt)}
                        {p.reversalReason ? `: ${p.reversalReason}` : ""}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {p.reversedAt ? (
                      <div className="text-sm font-semibold tabular-nums text-fg-muted line-through">{rupees(p.amount)}</div>
                    ) : (
                      <div className="text-sm font-semibold tabular-nums text-success-text">{rupees(p.amount)}</div>
                    )}
                    {canManage && !p.reversedAt && (
                      <Button size="sm" variant="ghost" icon={<Undo2 />} onClick={() => setReversing(p)} className="print:hidden">
                        Reverse
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex items-start gap-2 rounded-lg bg-surface-2 p-3 text-xs text-fg-muted">
            <Printer className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>The PDF prints three copies on one A4 page: bank, school and parent. Choose Save as PDF in the print window to download it.</span>
          </div>
        </Card>
      </div>

      {/* Printed voucher: three copies on one A4 page, bank, school and parent. Only shown when printing. */}
      <PrintableVoucher
        voucherNo={v.voucherNo}
        school={v.school}
        rows={[
          ["Student", fullName(v.student)],
          ["Adm. no.", v.student.admissionNo],
          ["Class", cls ? className : "None"],
          ["Guardian", guardian ?? "None"],
          [v.kind === "ADHOC" ? "Issued" : "Month", v.kind === "ADHOC" ? day(v.issueDate) : v.period],
          ["Due date", day(v.dueDate)],
        ]}
        lines={v.lines}
        total={v.total}
        paid={v.paid}
        balance={v.balance}
        lateFine={v.lateFine}
      />

      <Dialog
        open={payOpen}
        onOpenChange={setPayOpen}
        title="Record payment"
        description={`Balance on ${v.voucherNo} is ${rupees(v.balance)}.`}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setPayOpen(false)} disabled={paying}>
              Cancel
            </Button>
            <Button type="submit" form="record-payment" loading={paying} icon={<Banknote />}>
              Save payment
            </Button>
          </>
        }
      >
        <form id="record-payment" onSubmit={pay} className="grid gap-4 sm:grid-cols-2">
          {/* Nothing above the balance (plus any late fine collected with it) can be taken. */}
          <TextField
            label="Amount (Rs)"
            name="amount"
            type="number"
            min={1}
            max={v.balance + v.lateFine}
            defaultValue={v.balance + v.lateFine}
            required
            inputMode="numeric"
            hint={`At most ${rupees(v.balance + v.lateFine)}`}
          />
          <SelectField label="Method" name="method" options={METHODS.map((m) => ({ value: m, label: methodLabel(m) }))} />
          <TextField
            label="Reference"
            name="reference"
            hint="Bank or wallet transaction id, if any"
            wrapperClassName="sm:col-span-2"
          />
          {v.lateFine > 0 && (
            <p className="flex items-start gap-2 text-xs text-fg-muted sm:col-span-2">
              <CalendarClock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              A late fine of {rupees(v.lateFine)} has built up. It goes onto the voucher when you save, so anything not collected now stays owing.
            </p>
          )}
          {error && (
            <Alert tone="danger" className="sm:col-span-2">
              {error}
            </Alert>
          )}
        </form>
      </Dialog>

      <ReasonDialog
        open={voidOpen}
        onOpenChange={setVoidOpen}
        title="Void this voucher?"
        description={`${v.voucherNo} stops counting towards ${fullName(v.student)}'s balance and cannot take payments. It stays on record as cancelled.`}
        confirmLabel="Void voucher"
        placeholder="Billed by mistake"
        onConfirm={voidVoucher}
      />
      <ReasonDialog
        open={waiveOpen}
        onOpenChange={setWaiveOpen}
        title="Waive the late fine?"
        description={`No more late fine builds up on ${v.voucherNo}${v.fineBooked > 0 ? `, and the ${rupees(v.fineBooked)} fine already on it comes off whatever is still unpaid` : ""}. The reason is kept in the audit log.`}
        confirmLabel="Waive fine"
        placeholder="Family hardship, approved by the principal"
        onConfirm={waiveFine}
      />
      <ReasonDialog
        open={!!reversing}
        onOpenChange={(o) => !o && setReversing(null)}
        title="Reverse this payment?"
        description={
          reversing
            ? `Receipt ${reversing.receiptNo} for ${rupees(reversing.amount)} stays on record but no longer counts towards this voucher, the cash book or reports.`
            : ""
        }
        confirmLabel="Reverse payment"
        placeholder="Cheque bounced"
        onConfirm={reverse}
      />
      <AdjustDialog
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
        voucherId={v.id}
        voucherNo={v.voucherNo}
        onDone={async (message) => {
          toast.success("Voucher adjusted", message);
          await voucher.reload();
        }}
      />
    </div>
  );
}

/** Adds a discount or an extra charge to a voucher, with the reason. */
function AdjustDialog({
  open,
  onOpenChange,
  voucherId,
  voucherNo,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  voucherId: string;
  voucherNo: string;
  onDone: (message: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const f = new FormData(formEl);
    const rupeesOff = Number(f.get("amount"));
    const amount = f.get("kind") === "DISCOUNT" ? -rupeesOff : rupeesOff;
    setBusy(true);
    try {
      const res = await api<{ invoice: { total: number } }>(`/fees/invoices/${voucherId}/adjustments`, {
        method: "POST",
        body: { amount, reason: f.get("reason"), description: f.get("description") || undefined },
      });
      setError("");
      formEl.reset();
      onOpenChange(false);
      await onDone(`The voucher total is now ${rupees(res.invoice.total)}.`);
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
        onOpenChange(o);
        if (!o) setError("");
      }}
      title="Adjust voucher"
      description={`Adds a line to ${voucherNo}. A discount lowers what is owed; a charge adds to it.`}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="adjust-voucher" loading={busy} icon={<SlidersHorizontal />}>
            Add line
          </Button>
        </>
      }
    >
      <form id="adjust-voucher" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Type"
          name="kind"
          options={[
            { value: "DISCOUNT", label: "Discount" },
            { value: "CHARGE", label: "Extra charge" },
          ]}
        />
        <TextField label="Amount (Rs)" name="amount" type="number" min={1} required inputMode="numeric" />
        <TextField
          label="Line text"
          name="description"
          maxLength={80}
          placeholder="Discount"
          hint="Printed on the voucher"
          wrapperClassName="sm:col-span-2"
        />
        <TextField
          label="Reason"
          name="reason"
          required
          minLength={3}
          maxLength={300}
          placeholder="Approved by the principal"
          wrapperClassName="sm:col-span-2"
        />
        {error && (
          <Alert tone="danger" className="sm:col-span-2">
            {error}
          </Alert>
        )}
      </form>
    </Dialog>
  );
}
