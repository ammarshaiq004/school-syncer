"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { Banknote, CircleCheck, Download, Printer, ReceiptText, TriangleAlert, Wallet } from "lucide-react";
import { InvoiceBreakdownCard, PrintableVoucher, paymentMethodLabel, periodLabel } from "@/components/invoices/invoice-breakdown";
import { PayDuesDialog } from "@/components/invoices/pay-dues-dialog";
import { PARENT_INVOICE_LABEL, PARENT_INVOICE_TONE, type ParentInvoiceDetail } from "@/components/invoices/parent-types";
import {
  Alert,
  Avatar,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  SkeletonRows,
  StatusPill,
} from "@/components/ui";
import { day, rupees } from "@/lib/format";
import { useApi } from "@/lib/use-api";

const BASE_CRUMBS = [
  { label: "Parent Dashboard", href: "/parent" },
  { label: "Fee invoices", href: "/parent/invoices" },
];

/** Parent view of one fee voucher: breakdown, payments, PDF download and how to pay. */
export default function ParentInvoicePage() {
  const { id } = useParams<{ id: string }>();
  const res = useApi<ParentInvoiceDetail>(`/parent/invoices/${id}`);
  const [payOpen, setPayOpen] = useState(false);
  const v = res.data;

  if (!v) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Fee voucher" breadcrumbs={[...BASE_CRUMBS, { label: "Voucher" }]} />
        {res.error ? (
          <Card padding="none">
            <ErrorState
              title={res.errorStatus === 404 ? "Voucher not found" : undefined}
              message={res.errorStatus === 404 ? "This voucher does not belong to any of your children, or it was cancelled." : res.error}
              onRetry={res.errorStatus === 404 ? undefined : res.reload}
            />
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

  const b = v.breakdown;
  const month = periodLabel(v.period);
  const owes = b.totalDue > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Voucher ${v.voucherNo}`}
        description={`${v.student.name}, ${month}`}
        breadcrumbs={[...BASE_CRUMBS, { label: v.voucherNo }]}
        leading={<Avatar name={v.student.name} size="lg" />}
        meta={
          <>
            <StatusPill status={v.displayStatus} tone={PARENT_INVOICE_TONE[v.displayStatus]} label={PARENT_INVOICE_LABEL[v.displayStatus]} />
            <span className="text-[13px] text-fg-muted">Due {day(v.dueDate)}</span>
          </>
        }
        actions={
          <>
            <Button type="button" variant={owes ? "secondary" : "primary"} icon={<Download />} onClick={() => window.print()}>
              Download invoice PDF
            </Button>
            {owes && (
              <Button type="button" icon={<Wallet />} onClick={() => setPayOpen(true)}>
                Pay dues
              </Button>
            )}
          </>
        }
      />

      {v.displayStatus === "OVERDUE" && (
        <Alert tone="danger" title="This voucher is overdue" className="print:hidden" icon={<TriangleAlert />}>
          {rupees(b.balance)} was due on {day(v.dueDate)}.
          {b.lateFine > 0 && ` A late fee of ${rupees(b.lateFine)} has built up so far, so ${rupees(b.totalDue)} is payable now.`}
        </Alert>
      )}
      {v.displayStatus === "PAID" && (
        <Alert tone="success" title="Paid in full" className="print:hidden" icon={<CircleCheck />}>
          Thank you. Nothing is owed on this voucher.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3 print:hidden">
        <InvoiceBreakdownCard
          className="lg:col-span-2"
          voucherNo={v.voucherNo}
          school={v.school}
          details={[
            { label: "Student", value: v.student.name },
            { label: "Admission no.", value: v.student.admissionNo },
            { label: "Class", value: v.student.className ?? "Not enrolled" },
            { label: "Month", value: month },
            { label: "Issued", value: day(v.issueDate) },
            { label: "Due date", value: day(v.dueDate) },
          ]}
          lines={v.lines}
          total={b.total}
          paid={b.paid}
          balance={b.balance}
          lateFine={b.lateFine}
          showPayable
        />

        <Card className="self-start">
          <CardHeader
            title="Payments"
            description={v.payments.length === 1 ? "1 received" : `${v.payments.length} received`}
            icon={<ReceiptText />}
          />
          {v.payments.length === 0 ? (
            <EmptyState
              icon={<Banknote />}
              title="No payments yet"
              description={owes ? "Payments show here once the school office records them." : undefined}
              action={
                owes ? (
                  <Button type="button" size="sm" icon={<Wallet />} onClick={() => setPayOpen(true)}>
                    Pay dues
                  </Button>
                ) : null
              }
              compact
            />
          ) : (
            <ul className="-mx-1 divide-y divide-border">
              {v.payments.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-3 px-1 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-fg">{paymentMethodLabel(p.method)}</div>
                    <div className="text-xs text-fg-muted">
                      {day(p.receivedAt)}
                      {p.reference ? `, ref ${p.reference}` : ""}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-fg-muted">Receipt {p.receiptNo}</div>
                  </div>
                  <div className="shrink-0 text-sm font-semibold tabular-nums text-success-text">{rupees(p.amount)}</div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex items-start gap-2 rounded-lg bg-surface-2 p-3 text-xs text-fg-muted">
            <Printer className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              Download invoice PDF prints three copies on one A4 page: bank, school and parent. Choose Save as PDF in the print window to
              keep a copy.
            </span>
          </div>
        </Card>
      </div>

      <PrintableVoucher
        voucherNo={v.voucherNo}
        school={v.school}
        rows={[
          ["Student", v.student.name],
          ["Adm. no.", v.student.admissionNo],
          ["Class", v.student.className ?? "None"],
          ["Month", month],
          ["Due date", day(v.dueDate)],
        ]}
        lines={v.lines}
        total={b.total}
        paid={b.paid}
        balance={b.balance}
        lateFine={b.lateFine}
      />

      <PayDuesDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        invoice={{
          voucherNo: v.voucherNo,
          dueDate: v.dueDate,
          totalDue: b.totalDue,
          lateFine: b.lateFine,
          studentName: v.student.name,
          periodLabel: month,
          school: v.school,
        }}
      />
    </div>
  );
}
