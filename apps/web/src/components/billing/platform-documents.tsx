"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Printer } from "lucide-react";
import { Alert, Button, Card, ErrorState, PageHeader, Skeleton, SkeletonRows, StatusPill, type Crumb } from "@/components/kit";
import { periodLabel } from "@/components/invoices/invoice-breakdown";
import { rupeesInWords } from "@/lib/amount-words";
import { cn } from "@/lib/cn";
import { day, rupees, todayIso } from "@/lib/format";
import {
  BILL_STATE,
  billOwed,
  billState,
  businessLines,
  schoolLines,
  type BillDocument,
  type BilledSchool,
  type PlatformBill,
  type PlatformSettings,
  type ReceiptDocument,
} from "@/lib/platform-billing";

/**
 * SchoolSyncer's printable bill and receipt, shared by the console
 * (/platform/bills/[id], /platform/receipts/[id]) and the school's own copies
 * (/billing/bills/[id], /billing/receipts/[id]). Black on white, the same on
 * screen and paper; Print / Save as PDF uses the browser's print window.
 */

/** "Part paid", "Overdue"... for one bill. */
export function BillStatePill({ bill, className }: { bill: Pick<PlatformBill, "amount" | "amountPaid" | "status" | "dueDate">; className?: string }) {
  const state = billState(bill, todayIso());
  return <StatusPill status={state} tone={BILL_STATE[state].tone} label={BILL_STATE[state].label} className={className} />;
}

interface LoadState<T> {
  data: T | null;
  error: string;
  reload: () => Promise<void>;
}

interface PageProps<T> {
  state: LoadState<T>;
  /** Breadcrumbs before the document's own number. */
  crumbs: Crumb[];
}

/** The printable bill page: header with Print, then the bill itself. */
export function PlatformBillPage({ state, crumbs, receiptHref }: PageProps<BillDocument> & { receiptHref: (paymentId: string) => string }) {
  const doc = state.data;
  if (!doc) return <Loading title="Bill" crumbs={crumbs} state={state} />;
  const bill = doc.invoice;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Bill ${bill.number}`}
        description={`${bill.school.name}, ${periodLabel(bill.period)}`}
        breadcrumbs={[...crumbs, { label: bill.number }]}
        meta={
          <>
            <BillStatePill bill={bill} />
            <span className="text-[13px] text-fg-muted">Due {day(bill.dueDate)}</span>
          </>
        }
        actions={
          <Button icon={<Printer />} onClick={() => window.print()}>
            Print / Save as PDF
          </Button>
        }
      />
      {bill.status === "VOID" && (
        <Alert tone="neutral" title="This bill was cancelled" className="print:hidden">
          {bill.voidReason ? `${bill.voidReason}. ` : ""}Nothing is owed on it. Anything paid towards it became credit for the next bill.
        </Alert>
      )}
      <BillDocumentView doc={doc} receiptHref={receiptHref} />
      <PrintHint />
    </div>
  );
}

/** The printable receipt page. */
export function PlatformReceiptPage({ state, crumbs, billHref }: PageProps<ReceiptDocument> & { billHref: (invoiceId: string) => string }) {
  const doc = state.data;
  if (!doc) return <Loading title="Receipt" crumbs={crumbs} state={state} />;
  const p = doc.payment;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Receipt ${p.number}`}
        description={`${p.school.name}, ${rupees(p.amount)} on ${day(p.receivedOn)}`}
        breadcrumbs={[...crumbs, { label: p.number }]}
        meta={p.status === "VOID" ? <StatusPill status="VOID" label="Void" /> : <StatusPill status="PAID" label="Received" />}
        actions={
          <Button icon={<Printer />} onClick={() => window.print()}>
            Print / Save as PDF
          </Button>
        }
      />
      {p.status === "VOID" && (
        <Alert tone="danger" title={`This payment was cancelled${p.voidedAt ? ` on ${day(p.voidedAt)}` : ""}`} className="print:hidden">
          {p.voidReason ? `${p.voidReason}. ` : ""}It no longer counts towards any bill. The printed receipt is marked void.
        </Alert>
      )}
      <ReceiptDocumentView doc={doc} billHref={billHref} />
      <PrintHint />
    </div>
  );
}

function Loading<T>({ title, crumbs, state }: { title: string; crumbs: Crumb[]; state: LoadState<T> }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} breadcrumbs={[...crumbs, { label: title }]} />
      {state.error ? (
        <Card padding="none">
          <ErrorState message={state.error} onRetry={state.reload} />
        </Card>
      ) : (
        <Card className="max-w-[210mm]" aria-busy="true" aria-label={`Loading ${title.toLowerCase()}`}>
          <Skeleton className="h-5 w-48" />
          <SkeletonRows rows={6} columns={2} className="mt-6" />
        </Card>
      )}
    </div>
  );
}

function PrintHint() {
  return (
    <p className="flex items-center gap-2 text-xs text-fg-muted print:hidden">
      <Printer className="size-3.5" aria-hidden />
      In the print window choose Save as PDF to download a copy.
    </p>
  );
}

/** SchoolSyncer's name and details on the left, the document type and number on the right. */
function DocHeader({ settings, kind, number }: { settings: PlatformSettings; kind: string; number: string }) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-black/20 pb-4">
      <div className="min-w-0">
        <div className="text-lg font-bold leading-tight">{settings.businessName}</div>
        {businessLines(settings).map((line) => (
          <div key={line} className="text-xs text-black/70">
            {line}
          </div>
        ))}
      </div>
      <div className="shrink-0 text-right">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-black/60">{kind}</div>
        <div className="font-mono text-sm font-semibold">{number}</div>
      </div>
    </header>
  );
}

function SchoolBlock({ label, school }: { label: string; school: BilledSchool }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-black/60">{label}</div>
      <div className="mt-0.5 font-semibold">{school.name}</div>
      {schoolLines(school).map((line) => (
        <div key={line} className="text-xs text-black/70">
          {line}
        </div>
      ))}
      <div className="text-xs text-black/70">School code {school.slug}</div>
    </div>
  );
}

function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-black/60">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Watermark({ children, paid }: { children: ReactNode; paid?: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 flex items-center justify-center text-7xl font-black uppercase tracking-widest [transform:rotate(-24deg)]",
        paid ? "text-emerald-600/15" : "text-red-600/15",
      )}
    >
      {children}
    </div>
  );
}

const docClass =
  "relative w-full max-w-[210mm] overflow-hidden rounded-xl border border-border bg-white p-6 text-black shadow-sm sm:p-8 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none";

function Instructions({ text }: { text: string | null }) {
  if (!text?.trim()) return null;
  return (
    <section className="mt-6 rounded-lg border border-black/20 p-3 text-sm">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-black/60">How to pay</h3>
      <p className="mt-1 whitespace-pre-line">{text.trim()}</p>
    </section>
  );
}

/** Price per student when the bill divides evenly; otherwise it was the plan's monthly minimum. */
function rateLabel(subtotal: number, students: number) {
  if (students > 0 && subtotal % students === 0) return `${rupees(subtotal / students)} a student`;
  return "Plan minimum";
}

export function BillDocumentView({ doc, receiptHref }: { doc: BillDocument; receiptHref?: (paymentId: string) => string }) {
  const { invoice: bill, settings } = doc;
  const owed = billOwed(bill);
  const subtotal = bill.amount - bill.taxAmount;
  const applied = bill.allocations.filter((a) => a.payment.status === "RECORDED");
  return (
    <article aria-label={`Bill ${bill.number}`} className={docClass}>
      {bill.status === "VOID" && <Watermark>Void</Watermark>}
      {bill.status === "PAID" && <Watermark paid>Paid</Watermark>}
      <DocHeader settings={settings} kind="Bill" number={bill.number} />

      <div className="mt-4 grid gap-4 sm:grid-cols-2 print:grid-cols-2">
        <SchoolBlock label="Billed to" school={bill.school} />
        <Rows
          rows={[
            ["Bill no.", <span key="n" className="font-mono">{bill.number}</span>],
            ["Month", periodLabel(bill.period)],
            ["Issued", day(bill.createdAt)],
            ["Due date", <strong key="d">{day(bill.dueDate)}</strong>],
          ]}
        />
      </div>

      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="border-y border-black/20 text-[11px] uppercase tracking-wide text-black/60">
            <th scope="col" className="py-2 text-left font-semibold">Description</th>
            <th scope="col" className="py-2 text-right font-semibold">Students</th>
            <th scope="col" className="hidden py-2 text-right font-semibold sm:table-cell print:table-cell">Rate</th>
            <th scope="col" className="py-2 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-black/10">
            <td className="py-2.5 pe-3">
              SchoolSyncer {bill.planName} plan, {periodLabel(bill.period)}
            </td>
            <td className="py-2.5 text-right tabular-nums">{bill.students.toLocaleString("en-PK")}</td>
            <td className="hidden py-2.5 text-right sm:table-cell print:table-cell">{rateLabel(subtotal, bill.students)}</td>
            <td className="py-2.5 text-right tabular-nums">{rupees(subtotal)}</td>
          </tr>
        </tbody>
      </table>

      <dl className="ms-auto mt-3 flex max-w-xs flex-col gap-1.5 text-sm">
        {bill.taxAmount > 0 && (
          <>
            <Total label="Subtotal" value={rupees(subtotal)} />
            <Total label={`Sales tax (${bill.taxPercent}%)`} value={rupees(bill.taxAmount)} />
          </>
        )}
        <Total label="Total" value={rupees(bill.amount)} strong className="border-t border-black/20 pt-1.5" />
        <Total label="Paid so far" value={bill.amountPaid > 0 ? `- ${rupees(bill.amountPaid)}` : rupees(0)} />
        <div className="mt-1 flex items-baseline justify-between gap-3 rounded-md border border-black/30 px-3 py-2">
          <dt className="font-semibold">Still owed</dt>
          <dd className="text-lg font-bold tabular-nums">{rupees(owed)}</dd>
        </div>
        {owed > 0 && <p className="text-right text-xs text-black/60">Please pay by {day(bill.dueDate)}.</p>}
      </dl>

      {applied.length > 0 && (
        <section className="mt-6">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-black/60">Payments towards this bill</h3>
          <table className="mt-1 w-full text-sm">
            <tbody>
              {applied.map((a) => (
                <tr key={a.id} className="border-b border-black/10">
                  <td className="py-1.5 font-mono text-xs">
                    {receiptHref ? (
                      <Link href={receiptHref(a.payment.id)} className="underline-offset-2 hover:underline print:no-underline">
                        {a.payment.number}
                      </Link>
                    ) : (
                      a.payment.number
                    )}
                  </td>
                  <td className="py-1.5">{day(a.payment.receivedOn)}</td>
                  <td className="py-1.5">{a.payment.method}</td>
                  <td className="py-1.5 text-right tabular-nums">{rupees(a.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {bill.status === "VOID" && (
        <p className="mt-4 rounded-md border border-red-600/40 p-2 text-xs font-semibold text-red-700">
          CANCELLED{bill.voidReason ? `: ${bill.voidReason}` : ""}. Nothing is owed on this bill.
        </p>
      )}

      {bill.status !== "VOID" && <Instructions text={settings.paymentInstructions} />}

      <footer className="mt-8 text-xs text-black/60">
        Computer-generated bill. Please quote bill number {bill.number} when you pay.
      </footer>
    </article>
  );
}

export function ReceiptDocumentView({ doc, billHref }: { doc: ReceiptDocument; billHref?: (invoiceId: string) => string }) {
  const { payment: p, settings } = doc;
  const isVoid = p.status === "VOID";
  const appliedTotal = p.allocations.reduce((sum, a) => sum + a.amount, 0);
  const credit = isVoid ? 0 : p.amount - appliedTotal;
  return (
    <article aria-label={`Receipt ${p.number}`} className={cn(docClass, "max-w-[148mm] print:max-w-[148mm]")}>
      {isVoid && <Watermark>Void</Watermark>}
      <DocHeader settings={settings} kind="Payment receipt" number={p.number} />

      <div className="mt-4 flex flex-col gap-4">
        <SchoolBlock label="Received from" school={p.school} />
        <Rows
          rows={[
            ["Receipt no.", <span key="n" className="font-mono">{p.number}</span>],
            ["Received on", day(p.receivedOn)],
            ["Paid by", p.method],
            ...(p.reference ? ([["Reference", p.reference]] as [string, ReactNode][]) : []),
          ]}
        />
      </div>

      <div className="mt-5 rounded-lg border border-black/20 p-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm text-black/70">Amount received</span>
          <span className={cn("text-xl font-bold tabular-nums", isVoid && "line-through")}>{rupees(p.amount)}</span>
        </div>
        <div className="mt-1 text-sm italic">{rupeesInWords(p.amount)}</div>
      </div>

      <section className="mt-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-black/60">Applied to</h3>
        {p.allocations.length === 0 && !credit ? (
          <p className="mt-1 text-sm text-black/70">{isVoid ? "Nothing: this payment was cancelled." : "No bills yet."}</p>
        ) : (
          <table className="mt-1 w-full text-sm">
            <tbody>
              {p.allocations.map((a) => (
                <tr key={a.id} className="border-b border-black/10">
                  <td className="py-1.5 font-mono text-xs">
                    {billHref ? (
                      <Link href={billHref(a.invoice.id)} className="underline-offset-2 hover:underline print:no-underline">
                        {a.invoice.number}
                      </Link>
                    ) : (
                      a.invoice.number
                    )}
                  </td>
                  <td className="py-1.5">{periodLabel(a.invoice.period)} bill</td>
                  <td className="py-1.5 text-right tabular-nums">{rupees(a.amount)}</td>
                </tr>
              ))}
              {credit > 0 && (
                <tr className="border-b border-black/10">
                  <td className="py-1.5" colSpan={2}>
                    Kept as credit for your next bill
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{rupees(credit)}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </section>

      {isVoid && (
        <p className="mt-4 rounded-md border border-red-600/40 p-2 text-xs font-semibold text-red-700">
          VOID{p.voidedAt ? ` on ${day(p.voidedAt)}` : ""}
          {p.voidReason ? `: ${p.voidReason}` : ""}. This payment does not count.
        </p>
      )}

      <footer className="mt-8 flex items-end justify-between gap-4 text-xs text-black/60">
        <span>Computer-generated receipt. Thank you for your payment.</span>
      </footer>
    </article>
  );
}

function Total({ label, value, strong, className }: { label: string; value: string; strong?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", className)}>
      <dt className={cn(strong ? "font-semibold" : "text-black/70")}>{label}</dt>
      <dd className={cn("tabular-nums", strong && "font-semibold")}>{value}</dd>
    </div>
  );
}
