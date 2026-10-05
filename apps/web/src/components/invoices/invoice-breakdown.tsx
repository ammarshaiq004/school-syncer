import type { ReactNode } from "react";
import { Card, DescriptionList } from "@/components/kit";
import { cn } from "@/lib/cn";
import { rupees } from "@/lib/format";

/**
 * Shared fee voucher pieces: the on-screen breakdown card (staff voucher page and the
 * parent invoice page) and the printed three-copy voucher used by "Download invoice PDF".
 */

export interface InvoiceLine {
  id: string;
  description: string;
  /** Negative = concession or discount. */
  amount: number;
}

export interface InvoiceSchool {
  name: string;
  city?: string | null;
  phone?: string | null;
  email?: string | null;
}

const METHOD_LABEL: Record<string, string> = {
  CASH: "Cash",
  BANK: "Bank",
  JAZZCASH: "JazzCash",
  EASYPAISA: "Easypaisa",
  ONEBILL: "1Bill",
  CARD: "Card",
};
/** "JazzCash" from "JAZZCASH". */
export const paymentMethodLabel = (m: string) => METHOD_LABEL[m] ?? m.charAt(0) + m.slice(1).toLowerCase();

/** "October 2026" from "2026-10"; other period strings are returned as they are. */
export const periodLabel = (period: string) =>
  /^\d{4}-\d{2}$/.test(period)
    ? new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
    : period;

const schoolContact = (s: InvoiceSchool) => [s.city, s.phone, s.email].filter(Boolean).join(", ");

export interface InvoiceBreakdownCardProps {
  voucherNo: string;
  school: InvoiceSchool;
  /** Student, class, dates and so on, shown above the line items. */
  details: { label: string; value: ReactNode }[];
  lines: InvoiceLine[];
  /** Voucher total (charges minus concessions). The late fine is not part of it. */
  total: number;
  paid: number;
  balance: number;
  lateFine: number;
  /** Add a "Payable now" row (balance + late fine) when a late fine has built up. */
  showPayable?: boolean;
  className?: string;
}

/** Billed-by header, details, line items table and the totals block of a fee voucher. */
export function InvoiceBreakdownCard({
  voucherNo,
  school,
  details,
  lines,
  total,
  paid,
  balance,
  lateFine,
  showPayable,
  className,
}: InvoiceBreakdownCardProps) {
  const charges = lines.filter((l) => l.amount >= 0);
  const concessions = lines.filter((l) => l.amount < 0);
  const subtotal = charges.reduce((s, l) => s + l.amount, 0);
  const concessionTotal = concessions.reduce((s, l) => s + l.amount, 0);
  const payable = balance > 0 ? balance + lateFine : 0;

  return (
    <Card padding="none" className={cn("overflow-hidden", className)}>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-[0.04em] text-fg-muted">Billed by</div>
          <div className="mt-1 font-display text-base font-semibold text-fg">{school.name}</div>
          <div className="text-[13px] text-fg-muted">{schoolContact(school)}</div>
        </div>
        <div className="text-end">
          <div className="text-xs font-medium uppercase tracking-[0.04em] text-fg-muted">Voucher no.</div>
          <div className="mt-1 font-mono text-sm font-medium text-fg">{voucherNo}</div>
        </div>
      </div>
      <div className="border-b border-border p-5">
        <DescriptionList columns={3} items={details} />
      </div>

      <table className="w-full text-sm">
        <caption className="sr-only">Charges on voucher {voucherNo}</caption>
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
        {lateFine > 0 && (
          <SummaryRow
            label="Late fee so far"
            value={rupees(lateFine)}
            className="text-warning-text"
            hint="Grows each day after the due date. Not part of the voucher total."
          />
        )}
        <SummaryRow label="Total due" value={rupees(total)} strong className="mt-1 border-t border-border pt-3" />
        <SummaryRow label="Paid" value={paid > 0 ? `- ${rupees(paid)}` : rupees(0)} muted={paid === 0} />
        <div className="mt-1 flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2.5">
          <dt className="font-medium text-fg">Balance</dt>
          <dd className={cn("font-display text-lg font-semibold tabular-nums", balance > 0 ? "text-fg" : "text-success-text")}>
            {rupees(balance)}
          </dd>
        </div>
        {showPayable && lateFine > 0 && payable > 0 && (
          <SummaryRow label="Payable now, with late fee" value={rupees(payable)} strong className="px-3" />
        )}
        {concessionTotal < 0 && <p className="text-xs text-fg-muted">Includes {rupees(Math.abs(concessionTotal))} in concessions.</p>}
      </dl>
    </Card>
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

export interface PrintableVoucherProps {
  voucherNo: string;
  school: InvoiceSchool;
  /** Label/value rows printed under the school name (student, class, month, due date...). */
  rows: [label: string, value: ReactNode][];
  lines: InvoiceLine[];
  total: number;
  paid: number;
  balance: number;
  lateFine: number;
  copies?: string[];
}

/** Three copies (bank, school, parent) on one A4 page. Hidden on screen, shown only when printing. */
export function PrintableVoucher({
  voucherNo,
  school,
  rows,
  lines,
  total,
  paid,
  balance,
  lateFine,
  copies = ["Bank copy", "School copy", "Parent copy"],
}: PrintableVoucherProps) {
  return (
    <div className="hidden grid-cols-3 gap-2 text-[11px] print:grid">
      {copies.map((copy) => (
        <div key={copy} className="rounded-xl border border-dashed border-black/40 bg-white p-3 text-black">
          <div className="flex justify-between text-[10px] uppercase tracking-wide text-black/60">
            <span>{copy}</span>
            <span>{voucherNo}</span>
          </div>
          <div className="mt-1 text-sm font-bold">{school.name}</div>
          <div className="text-[10px] text-black/70">{[school.city, school.phone].filter(Boolean).join(", ")}</div>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3">
            {rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-black/60">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <table className="mt-2 w-full">
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.description}</td>
                  <td className="text-right">{rupees(l.amount)}</td>
                </tr>
              ))}
              <tr className="border-t border-black/30 font-bold">
                <td className="pt-1">Total</td>
                <td className="pt-1 text-right">{rupees(total)}</td>
              </tr>
              {paid > 0 && (
                <tr>
                  <td>Paid</td>
                  <td className="text-right">{rupees(paid)}</td>
                </tr>
              )}
              {paid > 0 && (
                <tr className="font-semibold">
                  <td>Balance</td>
                  <td className="text-right">{rupees(balance)}</td>
                </tr>
              )}
              {lateFine > 0 && (
                <tr>
                  <td>Late fine so far</td>
                  <td className="text-right">{rupees(lateFine)}</td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="mt-2 text-[10px] text-black/60">
            Pay at the school counter, by bank, or with JazzCash or Easypaisa using voucher no. {voucherNo}.
          </div>
        </div>
      ))}
    </div>
  );
}
