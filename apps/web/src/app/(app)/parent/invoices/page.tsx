"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CircleCheck, Clock, ReceiptText, TriangleAlert, Wallet } from "lucide-react";
import { CheckoutResult } from "@/components/invoices/checkout-result";
import { PayDuesDialog } from "@/components/invoices/pay-dues-dialog";
import { periodLabel } from "@/components/invoices/invoice-breakdown";
import {
  PARENT_INVOICE_LABEL,
  PARENT_INVOICE_TONE,
  type ParentInvoiceList,
  type ParentInvoiceRow,
} from "@/components/invoices/parent-types";
import {
  Button,
  DataTable,
  KpiCard,
  NativeSelect,
  PageHeader,
  StatGrid,
  StatusPill,
  type Column,
} from "@/components/ui";
import { day, rupees } from "@/lib/format";
import { useApi } from "@/lib/use-api";

const STATUS_OPTIONS = [
  { value: "OVERDUE", label: "Overdue" },
  { value: "PENDING", label: "Pending" },
  { value: "PAID", label: "Paid" },
];

/** "Paid Rs 14,000 on 14 Sep 2026" once a voucher is settled, else null. */
const settledText = (r: ParentInvoiceRow) =>
  r.totalDue > 0 ? null : `Paid ${rupees(r.paid)}${r.paidAt ? ` on ${day(r.paidAt)}` : ""}`;

/** Parent Dashboard: every fee voucher for all of the parent's children. */
export default function ParentInvoicesPage() {
  const router = useRouter();
  const res = useApi<ParentInvoiceList>("/parent/invoices");
  const [childId, setChildId] = useState("");
  const [status, setStatus] = useState("");
  const [paying, setPaying] = useState<ParentInvoiceRow | null>(null);

  const items = res.data?.items;
  const summary = res.data?.summary;
  const children = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of items ?? []) map.set(i.student.id, i.student.name);
    return [...map].map(([value, label]) => ({ value, label }));
  }, [items]);
  const rows = useMemo(
    () => items?.filter((i) => (!childId || i.student.id === childId) && (!status || i.displayStatus === status)) ?? null,
    [items, childId, status],
  );

  const columns: Column<ParentInvoiceRow>[] = [
    {
      id: "voucher",
      header: "Voucher",
      hideBelow: "sm",
      sortValue: (r) => r.voucherNo,
      cell: (r) => (
        <Link href={`/parent/invoices/${r.id}`} className="font-mono text-[13px] font-medium text-fg hover:text-brand">
          {r.voucherNo}
        </Link>
      ),
    },
    {
      id: "child",
      header: "Child",
      className: "px-3 sm:px-4",
      headerClassName: "px-3 sm:px-4",
      sortValue: (r) => r.student.name,
      cell: (r) => (
        <div className="min-w-0">
          <div className="font-medium text-fg">{r.student.name}</div>
          <div className="hidden text-xs text-fg-muted sm:block">{r.student.className ?? "Not enrolled"}</div>
          {/* Phones: the month, due date and status columns are hidden, so show them here. */}
          <div className="text-xs text-fg-muted sm:hidden">{periodLabel(r.period)}</div>
          <div className="text-xs text-fg-muted sm:hidden">{settledText(r) ?? `Due ${day(r.dueDate)}`}</div>
          <div className="mt-1 sm:hidden">
            <StatusPill status={r.displayStatus} tone={PARENT_INVOICE_TONE[r.displayStatus]} label={PARENT_INVOICE_LABEL[r.displayStatus]} />
          </div>
        </div>
      ),
    },
    { id: "period", header: "Month", hideBelow: "sm", sortValue: (r) => r.period, cell: (r) => periodLabel(r.period) },
    { id: "due", header: "Due date", sortValue: (r) => r.dueDate, cell: (r) => day(r.dueDate), hideBelow: "md" },
    { id: "total", header: "Voucher total", align: "right", sortValue: (r) => r.total, cell: (r) => rupees(r.total), hideBelow: "lg" },
    {
      id: "owed",
      header: "Amount due",
      className: "px-3 sm:px-4",
      headerClassName: "px-3 sm:px-4",
      align: "right",
      sortValue: (r) => r.totalDue,
      cell: (r) =>
        r.totalDue > 0 ? (
          <div>
            <div className="font-medium text-fg">{rupees(r.totalDue)}</div>
            {r.lateFine > 0 && <div className="text-xs text-warning-text">incl. {rupees(r.lateFine)} late fee</div>}
          </div>
        ) : (
          // A settled voucher said "Rs 0", which read as if nothing had been paid.
          <div>
            <div className="text-fg-muted">Nothing due</div>
            {/* Phones already carry this under the child's name. */}
            <div className="hidden text-xs text-fg-muted sm:block">Paid {rupees(r.paid)}</div>
          </div>
        ),
    },
    {
      id: "status",
      header: "Status",
      hideBelow: "sm",
      sortValue: (r) => r.displayStatus,
      cell: (r) => (
        <StatusPill status={r.displayStatus} tone={PARENT_INVOICE_TONE[r.displayStatus]} label={PARENT_INVOICE_LABEL[r.displayStatus]} />
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      className: "w-px whitespace-nowrap px-3 sm:px-4",
      headerClassName: "px-3 sm:px-4",
      cell: (r) =>
        r.totalDue > 0 ? (
          <Button size="sm" variant="secondary" type="button" icon={<Wallet />} onClick={() => setPaying(r)} aria-label={`Pay dues for voucher ${r.voucherNo}`}>
            <span className="sm:hidden">Pay</span>
            <span className="hidden sm:inline">Pay dues</span>
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Fee invoices and payment"
        description="Fee vouchers for all your children. Open one to see the breakdown, download it or pay."
        breadcrumbs={[{ label: "Parent Dashboard", href: "/parent" }, { label: "Fee invoices" }]}
      />

      <CheckoutResult onSettled={res.reload} />

      <StatGrid>
        <KpiCard
          label="Total due now"
          icon={<Wallet />}
          tone={summary && summary.overdueCount > 0 ? "danger" : "primary"}
          loading={!summary && !res.error}
          error={!!res.error}
          value={summary ? rupees(summary.totalDue) : ""}
          hint={summary ? (summary.totalDue > 0 ? "Includes any late fees so far" : "Nothing to pay right now") : undefined}
        />
        <KpiCard
          label="Overdue"
          icon={<TriangleAlert />}
          tone="danger"
          loading={!summary && !res.error}
          error={!!res.error}
          value={summary?.overdueCount ?? ""}
          hint="Past the due date"
        />
        <KpiCard
          label="Pending"
          icon={<Clock />}
          tone="warning"
          loading={!summary && !res.error}
          error={!!res.error}
          value={summary?.pendingCount ?? ""}
          hint="Not yet due"
        />
        <KpiCard
          label="Paid"
          icon={<CircleCheck />}
          tone="success"
          loading={!summary && !res.error}
          error={!!res.error}
          value={summary?.paidCount ?? ""}
          hint="Vouchers settled"
        />
      </StatGrid>

      <DataTable
        label="Fee vouchers"
        columns={columns}
        data={rows}
        error={res.error}
        onRetry={res.reload}
        getRowId={(r) => r.id}
        getSearchText={(r) => `${r.voucherNo} ${r.student.name} ${periodLabel(r.period)}`}
        searchPlaceholder="Search voucher no., child or month"
        filters={
          <>
            {children.length > 1 && (
              <NativeSelect
                aria-label="Child"
                placeholder="All children"
                options={children}
                value={childId}
                onChange={(e) => setChildId(e.target.value)}
                wrapperClassName="w-44"
              />
            )}
            <NativeSelect
              aria-label="Status"
              placeholder="All statuses"
              options={STATUS_OPTIONS}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              wrapperClassName="w-40"
            />
          </>
        }
        filtered={!!childId || !!status}
        defaultSort={{ id: "period", dir: "desc" }}
        empty={{
          icon: <ReceiptText />,
          title: "No fee vouchers yet",
          description: "Vouchers appear here as soon as the school issues them.",
        }}
        onRowClick={(r) => router.push(`/parent/invoices/${r.id}`)}
        getRowLabel={(r) => `Voucher ${r.voucherNo} for ${r.student.name}, ${periodLabel(r.period)}`}
      />

      {paying && (
        <PayDuesDialog
          open={!!paying}
          onOpenChange={(o) => !o && setPaying(null)}
          invoice={{
            invoiceId: paying.id,
            voucherNo: paying.voucherNo,
            dueDate: paying.dueDate,
            totalDue: paying.totalDue,
            lateFine: paying.lateFine,
            studentName: paying.student.name,
            periodLabel: periodLabel(paying.period),
          }}
        />
      )}
    </div>
  );
}
