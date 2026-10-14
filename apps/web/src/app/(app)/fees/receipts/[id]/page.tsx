"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Printer, ReceiptText } from "lucide-react";
import { Alert, Button, Card, ErrorState, PageHeader, Skeleton, SkeletonRows } from "@/components/ui";
import { rupeesInWords } from "@/lib/amount-words";
import { day, fullName, rupees } from "@/lib/format";
import { useApi } from "@/lib/use-api";

/** Shape of GET /fees/payments/:id/receipt. */
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
  invoice: {
    id: string;
    voucherNo: string;
    period: string;
    kind: "MONTHLY" | "ADHOC";
    total: number;
    paid: number;
    balance: number;
    school: { name: string; city: string | null; phone: string | null; email: string | null; logoUrl: string | null };
    student: {
      firstName: string;
      lastName: string | null;
      admissionNo: string;
      enrollments: { section: { name: string; class: { name: string } } }[];
      guardians: { guardian: { name: string } }[];
    };
  };
}

const METHOD_LABEL: Record<string, string> = { CASH: "Cash", BANK: "Bank", JAZZCASH: "JazzCash", EASYPAISA: "Easypaisa", ONEBILL: "1Bill", CARD: "Card" };

const monthLabel = (period: string) =>
  new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/** A printable payment receipt: sized for A5, prints cleanly on A4. */
export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const receipt = useApi<Receipt>(`/fees/payments/${id}/receipt`);
  const r = receipt.data;

  if (!r) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Receipt" breadcrumbs={[{ label: "Fees", href: "/fees" }, { label: "Receipt" }]} />
        {receipt.error ? (
          <Card padding="none">
            <ErrorState message={receipt.error} onRetry={receipt.reload} />
          </Card>
        ) : (
          <Card className="max-w-xl" aria-busy="true" aria-label="Loading receipt">
            <Skeleton className="h-5 w-48" />
            <SkeletonRows rows={6} columns={2} className="mt-6" />
          </Card>
        )}
      </div>
    );
  }

  const { invoice, invoice: { school, student } } = r;
  const cls = student.enrollments[0];
  const rows: [string, string][] = [
    ["Student", fullName(student)],
    ["Admission no.", student.admissionNo],
    ["Class", cls ? `${cls.section.class.name} ${cls.section.name}` : "Not enrolled"],
    ["Guardian", student.guardians[0]?.guardian.name ?? "Not added"],
    ["Voucher", `${invoice.voucherNo}${invoice.kind === "MONTHLY" ? `, ${monthLabel(invoice.period)}` : ""}`],
    ["Paid by", `${METHOD_LABEL[r.method] ?? r.method}${r.online ? " (online)" : ""}${r.reference ? `, ref ${r.reference}` : ""}`],
    ["Received", `${day(r.receivedAt)}${r.receivedBy ? ` by ${r.receivedBy.name}` : ""}`],
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        className="print:hidden"
        title={`Receipt ${r.receiptNo}`}
        description={`${fullName(student)}, ${rupees(r.amount)}`}
        breadcrumbs={[{ label: "Fees", href: "/fees" }, { label: invoice.voucherNo, href: `/fees/invoices/${invoice.id}` }, { label: r.receiptNo }]}
        actions={
          <Button icon={<Printer />} onClick={() => window.print()}>
            Print receipt
          </Button>
        }
      />
      {r.reversedAt && (
        <Alert tone="danger" title={`This payment was reversed on ${day(r.reversedAt)}`} className="print:hidden">
          {r.reversalReason ? `${r.reversalReason}. ` : ""}It no longer counts towards the voucher. The printed receipt is marked reversed.
        </Alert>
      )}

      {/* The receipt itself: A5 wide, black on white, the same on screen and paper. */}
      <article
        aria-label={`Receipt ${r.receiptNo}`}
        className="relative w-full max-w-[148mm] overflow-hidden rounded-xl border border-border bg-white p-6 text-black shadow-sm print:max-w-[148mm] print:rounded-none print:border-black/40 print:shadow-none"
      >
        {r.reversedAt && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-center text-6xl font-black uppercase tracking-widest text-red-600/20 [transform:rotate(-24deg)]"
          >
            Reversed
          </div>
        )}
        <header className="flex items-start justify-between gap-4 border-b border-black/20 pb-3">
          <div className="flex min-w-0 items-center gap-3">
            {school.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- school logos are external URLs.
              <img src={school.logoUrl} alt="" className="size-12 shrink-0 object-contain" />
            )}
            <div className="min-w-0">
              <div className="text-base font-bold leading-tight">{school.name}</div>
              <div className="text-xs text-black/70">{[school.city, school.phone, school.email].filter(Boolean).join(" | ")}</div>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-black/60">Payment receipt</div>
            <div className="font-mono text-sm font-semibold">{r.receiptNo}</div>
          </div>
        </header>

        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-black/60">{label}</dt>
              <dd className="min-w-0 break-words">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-5 rounded-lg border border-black/20 p-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-black/70">Amount received</span>
            <span className={r.reversedAt ? "text-xl font-bold tabular-nums line-through" : "text-xl font-bold tabular-nums"}>{rupees(r.amount)}</span>
          </div>
          <div className="mt-1 text-sm italic">{rupeesInWords(r.amount)}</div>
        </div>

        <table className="mt-4 w-full text-sm">
          <tbody>
            <tr>
              <td className="py-0.5 text-black/60">Voucher total</td>
              <td className="py-0.5 text-right tabular-nums">{rupees(invoice.total)}</td>
            </tr>
            <tr>
              <td className="py-0.5 text-black/60">Paid on this voucher</td>
              <td className="py-0.5 text-right tabular-nums">{rupees(invoice.paid)}</td>
            </tr>
            <tr className="font-semibold">
              <td className="py-0.5">Balance now</td>
              <td className="py-0.5 text-right tabular-nums">{rupees(invoice.balance)}</td>
            </tr>
          </tbody>
        </table>

        {r.reversedAt && (
          <p className="mt-4 rounded-md border border-red-600/40 p-2 text-xs font-semibold text-red-700">
            REVERSED on {day(r.reversedAt)}
            {r.reversalReason ? `: ${r.reversalReason}` : ""}. This payment does not count.
          </p>
        )}

        <footer className="mt-8 flex items-end justify-between gap-4 text-xs text-black/60">
          <span>Computer-generated receipt. Keep it for your records.</span>
          <span className="shrink-0 border-t border-black/40 pt-1">Signature and stamp</span>
        </footer>
      </article>

      <p className="flex items-center gap-2 text-xs text-fg-muted print:hidden">
        <ReceiptText className="size-3.5" aria-hidden />
        In the print window choose A5 for a half-page receipt, or A4; choose Save as PDF to download it.{" "}
        <Link className="font-medium text-brand hover:underline" href={`/fees/invoices/${invoice.id}`}>
          Back to the voucher
        </Link>
      </p>
    </div>
  );
}
