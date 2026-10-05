"use client";

import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Banknote, CalendarClock, Download, Printer, ReceiptText, TriangleAlert } from "lucide-react";
import { InvoiceStatusPill, invoiceDisplay } from "@/components/fees/invoice-status";
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
  const voucher = useApi<Voucher>(`/fees/invoices/${id}`);
  const [payOpen, setPayOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");
  const v = voucher.data;

  async function pay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const f = new FormData(formEl);
    setPaying(true);
    try {
      const res = await api<{ payment: { receiptNo: string } }>(`/fees/invoices/${id}/payments`, {
        method: "POST",
        body: { amount: Number(f.get("amount")), method: f.get("method"), reference: f.get("reference") || undefined },
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
  const canPay = v.status !== "PAID" && v.status !== "CANCELLED";
  const display = invoiceDisplay(v);

  const payButton = canPay ? (
    <Button icon={<Banknote />} onClick={() => { setError(""); setPayOpen(true); }}>
      Record payment
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Voucher ${v.voucherNo}`}
        description={`${fullName(v.student)}, ${monthLabel(v.period)}`}
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
          {v.lateFine > 0 && ` A late fine of ${rupees(v.lateFine)} has built up so far.`}
        </Alert>
      )}
      {v.status === "CANCELLED" && (
        <Alert tone="neutral" title="This voucher was cancelled" className="print:hidden">
          It no longer counts towards the student&apos;s balance and cannot take payments.
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
          <CardHeader title="Payments" description={`${v.payments.length} received`} icon={<ReceiptText />} />
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
                    <div className="mt-0.5 font-mono text-[11px] text-fg-muted">{p.receiptNo}</div>
                  </div>
                  <div className="shrink-0 text-sm font-semibold tabular-nums text-success-text">{rupees(p.amount)}</div>
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
          ["Month", v.period],
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
          <TextField label="Amount (Rs)" name="amount" type="number" min={1} defaultValue={v.balance} required inputMode="numeric" />
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
              A late fine of {rupees(v.lateFine)} has built up. Add it to the amount if you are collecting it.
            </p>
          )}
          {error && (
            <Alert tone="danger" className="sm:col-span-2">
              {error}
            </Alert>
          )}
        </form>
      </Dialog>
    </div>
  );
}
