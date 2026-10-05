"use client";

import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Banknote, CalendarClock, Download, Printer, ReceiptText, TriangleAlert } from "lucide-react";
import { InvoiceStatusPill, invoiceDisplay } from "@/components/fees/invoice-status";
import {
  Alert,
  Avatar,
  Button,
  Card,
  CardHeader,
  DescriptionList,
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
import { cn } from "@/lib/cn";
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
  const charges = v.lines.filter((l) => l.amount >= 0);
  const concessions = v.lines.filter((l) => l.amount < 0);
  const subtotal = charges.reduce((s, l) => s + l.amount, 0);
  const concessionTotal = concessions.reduce((s, l) => s + l.amount, 0);
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
        <Card padding="none" className="overflow-hidden lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5">
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase tracking-[0.04em] text-fg-muted">Billed by</div>
              <div className="mt-1 font-display text-base font-semibold text-fg">{v.school.name}</div>
              <div className="text-[13px] text-fg-muted">{[v.school.city, v.school.phone].filter(Boolean).join(", ")}</div>
            </div>
            <div className="text-end">
              <div className="text-xs font-medium uppercase tracking-[0.04em] text-fg-muted">Voucher no.</div>
              <div className="mt-1 font-mono text-sm font-medium text-fg">{v.voucherNo}</div>
            </div>
          </div>
          <div className="border-b border-border p-5">
            <DescriptionList
              columns={3}
              items={[
                { label: "Student", value: fullName(v.student) },
                { label: "Admission no.", value: v.student.admissionNo },
                { label: "Class", value: className },
                { label: "Guardian", value: guardian ?? "Not added" },
                { label: "Issued", value: day(v.issueDate) },
                { label: "Due date", value: day(v.dueDate) },
              ]}
            />
          </div>

          <table className="w-full text-sm">
            <caption className="sr-only">Charges on voucher {v.voucherNo}</caption>
            <thead className="bg-surface-2">
              <tr>
                <th scope="col" className="px-5 py-2.5 text-start text-xs font-medium uppercase tracking-[0.04em] text-fg-muted">
                  Item
                </th>
                <th scope="col" className="px-5 py-2.5 text-end text-xs font-medium uppercase tracking-[0.04em] text-fg-muted">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {charges.map((l) => (
                <tr key={l.id}>
                  <td className="px-5 py-3 text-fg">{l.description}</td>
                  <td className="px-5 py-3 text-end tabular-nums text-fg">{rupees(l.amount)}</td>
                </tr>
              ))}
              {charges.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-5 py-6 text-center text-fg-muted">
                    No charges on this voucher.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <dl className="ms-auto flex max-w-sm flex-col gap-2 border-t border-border p-5 text-sm">
            <SummaryRow label="Subtotal" value={rupees(subtotal)} />
            {concessions.map((l) => (
              <SummaryRow key={l.id} label={l.description} value={`- ${rupees(Math.abs(l.amount))}`} className="text-success-text" />
            ))}
            {concessions.length === 0 && <SummaryRow label="Concessions" value={rupees(0)} muted />}
            {v.lateFine > 0 && (
              <SummaryRow
                label="Late fee so far"
                value={rupees(v.lateFine)}
                className="text-warning-text"
                hint="Grows each day after the due date. Not part of the voucher total."
              />
            )}
            <SummaryRow label="Total due" value={rupees(v.total)} strong className="mt-1 border-t border-border pt-3" />
            <SummaryRow label="Paid" value={v.paid > 0 ? `- ${rupees(v.paid)}` : rupees(0)} muted={v.paid === 0} />
            <div className="mt-1 flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2.5">
              <dt className="font-medium text-fg">Balance</dt>
              <dd className={cn("font-display text-lg font-semibold tabular-nums", v.balance > 0 ? "text-fg" : "text-success-text")}>
                {rupees(v.balance)}
              </dd>
            </div>
            {concessionTotal < 0 && (
              <p className="text-xs text-fg-muted">Includes {rupees(Math.abs(concessionTotal))} in concessions.</p>
            )}
          </dl>
        </Card>

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
      <div className="hidden grid-cols-3 gap-2 text-[11px] print:grid">
        {["Bank copy", "School copy", "Parent copy"].map((copy) => (
          <div key={copy} className="rounded-xl border border-dashed border-black/40 bg-white p-3 text-black">
            <div className="flex justify-between text-[10px] uppercase tracking-wide text-black/60">
              <span>{copy}</span>
              <span>{v.voucherNo}</span>
            </div>
            <div className="mt-1 text-sm font-bold">{v.school.name}</div>
            <div className="text-[10px] text-black/70">{[v.school.city, v.school.phone].filter(Boolean).join(", ")}</div>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3">
              <dt className="text-black/60">Student</dt><dd className="font-medium">{fullName(v.student)}</dd>
              <dt className="text-black/60">Adm. no.</dt><dd>{v.student.admissionNo}</dd>
              <dt className="text-black/60">Class</dt><dd>{cls ? className : "None"}</dd>
              <dt className="text-black/60">Guardian</dt><dd>{guardian ?? "None"}</dd>
              <dt className="text-black/60">Month</dt><dd>{v.period}</dd>
              <dt className="text-black/60">Due date</dt><dd className="font-medium">{day(v.dueDate)}</dd>
            </dl>
            <table className="mt-2 w-full">
              <tbody>
                {v.lines.map((l) => (
                  <tr key={l.id}><td>{l.description}</td><td className="text-right">{rupees(l.amount)}</td></tr>
                ))}
                <tr className="border-t border-black/30 font-bold"><td className="pt-1">Total</td><td className="pt-1 text-right">{rupees(v.total)}</td></tr>
                {v.paid > 0 && <tr><td>Paid</td><td className="text-right">{rupees(v.paid)}</td></tr>}
                {v.paid > 0 && <tr className="font-semibold"><td>Balance</td><td className="text-right">{rupees(v.balance)}</td></tr>}
                {v.lateFine > 0 && <tr><td>Late fine so far</td><td className="text-right">{rupees(v.lateFine)}</td></tr>}
              </tbody>
            </table>
            <div className="mt-2 text-[10px] text-black/60">
              Pay at the school counter, by bank, or with JazzCash or Easypaisa using voucher no. {v.voucherNo}.
            </div>
          </div>
        ))}
      </div>

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

function SummaryRow({
  label,
  value,
  strong,
  muted,
  hint,
  className,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3", muted && "text-fg-muted", className)}>
      <dt className={cn(strong ? "font-semibold text-fg" : "")}>
        {label}
        {hint && <span className="block text-xs font-normal text-fg-muted">{hint}</span>}
      </dt>
      <dd className={cn("shrink-0 tabular-nums", strong && "font-semibold text-fg")}>{value}</dd>
    </div>
  );
}
