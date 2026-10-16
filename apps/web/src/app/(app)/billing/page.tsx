"use client";

import Link from "next/link";
import { useState } from "react";
import { Bell, Building, CalendarClock, Check, CircleAlert, CreditCard, FileText, Landmark, PiggyBank, ReceiptText, Users, Wallet } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  KpiCard,
  PageHeader,
  Section,
  Skeleton,
  SkeletonCards,
  StatGrid,
  StatusPill,
  Tooltip,
  useToast,
  type Column,
} from "@/components/ui";
import { BillStatePill } from "@/components/billing/platform-documents";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { day, rupees } from "@/lib/format";
import { hasRole, useSession } from "@/lib/session";
import { billOwed, noticeTone, type PlatformBill, type PlatformNotice, type PlatformPaymentStatus } from "@/lib/platform-billing";
import { useApi } from "@/lib/use-api";

interface PlanOption {
  code: string;
  name: string;
  description: string | null;
  pricePerStudent: number;
  minimumMonthly: number;
  maxStudents: number | null;
  maxCampuses: number | null;
  features: string[];
  estimate: number;
  fits: boolean;
}

type Invoice = PlatformBill;

/** A payment to SchoolSyncer as GET /subscription lists it. */
interface Payment {
  id: string;
  number: string;
  amount: number;
  method: string;
  reference: string | null;
  receivedOn: string;
  status: PlatformPaymentStatus;
  /** Numbers of the bills it paid. */
  bills: string[];
}

interface Subscription {
  status: string;
  trialEndsAt: string | null;
  access: "full" | "read_only" | "blocked";
  reason: string | null;
  plan: { code: string; name: string };
  usage: { students: number; campuses: number };
  estimate: number;
  plans: PlanOption[];
  invoices: Invoice[];
  /** Still owed across all bills. */
  outstanding: number;
  /** Paid in advance, taken off the next bill. */
  credit: number;
  payments: Payment[];
  notices: PlatformNotice[];
  /** How to pay SchoolSyncer, from its settings; null when not set. */
  paymentInstructions: string | null;
}

const linkClass = "inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline [&_svg]:size-3.5";

const STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "info" }> = {
  TRIAL: { label: "Free trial", tone: "info" },
  ACTIVE: { label: "Active", tone: "success" },
  PAST_DUE: { label: "Payment overdue", tone: "warning" },
  SUSPENDED: { label: "Suspended", tone: "danger" },
  CANCELLED: { label: "Cancelled", tone: "danger" },
};

const monthName = (period: string) =>
  new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export default function BillingPage() {
  const user = useSession();
  const toast = useToast();
  const sub = useApi<Subscription>("/subscription");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [confirming, setConfirming] = useState<PlanOption | null>(null);
  const isOwner = hasRole(user, ["OWNER"]);

  async function choose(plan: PlanOption) {
    setBusy(plan.code);
    setError("");
    try {
      await api("/subscription/plan", { method: "POST", body: { planCode: plan.code } });
      toast.success(`The school is now on the ${plan.name} plan`, "Reloading...");
      // The menu and banner come from the session, so start it again.
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
      setConfirming(null);
    } finally {
      setBusy("");
    }
  }

  async function markRead(ids: string[]) {
    try {
      await Promise.all(ids.map((id) => api(`/subscription/notices/${id}/read`, { method: "POST" })));
      await sub.reload();
    } catch (e) {
      toast.error("Could not mark the message read", (e as Error).message);
    }
  }

  const s = sub.data;
  const owed = s?.outstanding ?? 0;
  const unreadIds = s?.notices.filter((n) => !n.readAt).map((n) => n.id) ?? [];
  const status = s ? STATUS[s.status] : undefined;

  const columns: Column<Invoice>[] = [
    { id: "number", header: "Bill", sortValue: (i) => i.number, cell: (i) => <span className="font-mono text-xs font-medium text-fg">{i.number}</span> },
    { id: "period", header: "Month", sortValue: (i) => i.period, cell: (i) => monthName(i.period) },
    { id: "plan", header: "Plan", cell: (i) => i.planName, hideBelow: "md" },
    { id: "students", header: "Students", align: "right", sortValue: (i) => i.students, cell: (i) => i.students.toLocaleString("en-PK"), hideBelow: "md" },
    {
      id: "amount",
      header: "Amount",
      align: "right",
      sortValue: (i) => i.amount,
      cell: (i) =>
        i.status === "VOID" ? <span className="text-fg-muted line-through">{rupees(i.amount)}</span> : <span className="font-medium text-fg">{rupees(i.amount)}</span>,
    },
    {
      id: "paid",
      header: "Paid so far",
      align: "right",
      sortValue: (i) => i.amountPaid,
      cell: (i) => (i.amountPaid ? rupees(i.amountPaid) : <span className="text-fg-muted">–</span>),
      hideBelow: "md",
    },
    {
      id: "owed",
      header: "Still owed",
      align: "right",
      sortValue: (i) => billOwed(i),
      cell: (i) => (billOwed(i) ? <span className="font-medium text-fg">{rupees(billOwed(i))}</span> : <span className="text-fg-muted">–</span>),
    },
    { id: "due", header: "Due", sortValue: (i) => i.dueDate, cell: (i) => day(i.dueDate), hideBelow: "sm" },
    {
      id: "status",
      header: "Status",
      cell: (i) =>
        i.status === "PAID" ? (
          <StatusPill status="PAID" label={i.paidAt ? `Paid ${day(i.paidAt)}` : "Paid"} />
        ) : i.status === "VOID" ? (
          <span className="flex max-w-56 flex-col items-start gap-0.5">
            <StatusPill status="CANCELLED" label="Cancelled" />
            {i.voidReason && <span className="text-xs text-fg-muted">{i.voidReason}</span>}
          </span>
        ) : (
          <BillStatePill bill={i} />
        ),
    },
    {
      id: "view",
      header: <span className="sr-only">Bill</span>,
      align: "right",
      cell: (i) => (
        <Link href={`/billing/bills/${i.id}`} className={linkClass} aria-label={`View or print bill ${i.number}`}>
          <FileText aria-hidden />
          View
        </Link>
      ),
    },
  ];

  const paymentColumns: Column<Payment>[] = [
    { id: "number", header: "Receipt", sortValue: (p) => p.number, cell: (p) => <span className="font-mono text-xs font-medium text-fg">{p.number}</span> },
    { id: "received", header: "Received on", sortValue: (p) => p.receivedOn, cell: (p) => day(p.receivedOn) },
    {
      id: "amount",
      header: "Amount",
      align: "right",
      sortValue: (p) => p.amount,
      cell: (p) =>
        p.status === "VOID" ? <span className="text-fg-muted line-through">{rupees(p.amount)}</span> : <span className="font-medium text-fg">{rupees(p.amount)}</span>,
    },
    { id: "method", header: "Paid by", cell: (p) => [p.method, p.reference].filter(Boolean).join(", "), hideBelow: "md" },
    { id: "bills", header: "For bills", cell: (p) => (p.bills.length ? p.bills.join(", ") : <span className="text-fg-muted">Credit</span>), hideBelow: "sm" },
    {
      id: "status",
      header: "Status",
      cell: (p) => (p.status === "VOID" ? <StatusPill status="CANCELLED" label="Cancelled" /> : <StatusPill status="PAID" label="Received" />),
    },
    {
      id: "receipt",
      header: <span className="sr-only">Receipt</span>,
      align: "right",
      cell: (p) => (
        <Link href={`/billing/receipts/${p.id}`} className={linkClass} aria-label={`View or print receipt ${p.number}`}>
          <FileText aria-hidden />
          Receipt
        </Link>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Plan and billing"
        description="Your SchoolSyncer plan, what it costs and the bills we have sent."
        breadcrumbs={[{ label: "Settings" }, { label: "Plan and billing" }]}
        meta={s && status ? <StatusPill status={s.status} tone={status.tone} label={status.label} /> : undefined}
      />

      {sub.error ? (
        <Card padding="none">
          <ErrorState message={sub.error} onRetry={sub.reload} />
        </Card>
      ) : !s ? (
        <>
          <SkeletonCards count={4} />
          <div className="grid gap-4 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Card key={i}>
                <Skeleton className="h-5 w-24" />
                <Skeleton className="mt-3 h-8 w-32" />
                <Skeleton className="mt-4 h-24 w-full" />
              </Card>
            ))}
          </div>
        </>
      ) : (
        <>
          {s.reason && (
            <Alert tone={s.access === "full" ? "warning" : "danger"} title={status?.label ?? "Account notice"}>
              {s.reason}
            </Alert>
          )}
          {owed > 0 && (
            <Alert tone="warning" icon={<CircleAlert />} title={`${rupees(owed)} still owed to SchoolSyncer`}>
              {s.paymentInstructions
                ? "See how to pay below, and quote the bill number with your payment."
                : "Pay by bank transfer or JazzCash and send the receipt to SchoolSyncer support with the bill number."}
            </Alert>
          )}

          <StatGrid>
            <KpiCard label="Current plan" value={s.plan.name} icon={<CreditCard />} hint={status?.label ?? s.status} />
            <KpiCard label="Active students" value={s.usage.students.toLocaleString("en-PK")} icon={<Users />} tone="info" />
            <KpiCard label="Campuses" value={s.usage.campuses.toLocaleString("en-PK")} icon={<Building />} tone="neutral" />
            {s.trialEndsAt && s.status === "TRIAL" ? (
              <KpiCard label="Trial ends" value={day(s.trialEndsAt)} icon={<CalendarClock />} tone="warning" hint={`Then about ${rupees(s.estimate)} a month`} />
            ) : (
              <KpiCard label={s.status === "TRIAL" ? "Would cost per month" : "This month, about"} value={rupees(s.estimate)} icon={<ReceiptText />} tone="success" />
            )}
          </StatGrid>

          <div className="grid gap-4 lg:grid-cols-3">
            <KpiCard
              label="Still owed"
              value={rupees(owed)}
              icon={<Wallet />}
              tone={owed > 0 ? "warning" : "success"}
              hint={owed > 0 ? "Across all unpaid bills" : "All bills are paid. Thank you!"}
            />
            <KpiCard
              label="Credit for your next bill"
              value={rupees(s.credit)}
              icon={<PiggyBank />}
              tone="info"
              hint={s.credit > 0 ? "Taken off your next bill automatically" : "Pay more than a bill and the rest is kept here"}
            />
            <Card>
              <CardHeader title="How to pay" icon={<Landmark />} />
              {s.paymentInstructions ? (
                <p className="whitespace-pre-line text-sm text-fg-secondary">{s.paymentInstructions}</p>
              ) : (
                <p className="text-sm text-fg-muted">
                  Pay by bank transfer or JazzCash and send the receipt to SchoolSyncer support with the bill number.
                </p>
              )}
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Messages from SchoolSyncer"
              description="Bills, reminders and payments we have received. These also go to the school owner by SMS and email."
              icon={<Bell />}
              action={
                unreadIds.length > 1 ? (
                  <Button type="button" size="sm" variant="ghost" onClick={() => markRead(unreadIds)}>
                    Mark all as read
                  </Button>
                ) : undefined
              }
            />
            {s.notices.length === 0 ? (
              <EmptyState icon={<Bell />} title="No messages yet" description="Bill reminders and payment confirmations will show up here." compact />
            ) : (
              <ul className="-mx-1 divide-y divide-border">
                {s.notices.map((n) => (
                  <li key={n.id} className={cn("flex items-start gap-3 px-1 py-3", !n.readAt && "rounded-lg bg-primary-tint/40")}>
                    <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-primary")} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn("text-sm text-fg", !n.readAt && "font-semibold")}>{n.title}</span>
                        {n.severity !== "INFO" && (
                          <StatusPill status={n.severity} tone={noticeTone(n.severity)} label={n.severity === "URGENT" ? "Urgent" : "Important"} />
                        )}
                        {!n.readAt && <span className="sr-only">(unread)</span>}
                      </div>
                      <p className="mt-0.5 text-sm text-fg-secondary">{n.body}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-fg-muted">
                        <time dateTime={n.createdAt}>{day(n.createdAt)}</time>
                        {n.invoiceId && (
                          <Link href={`/billing/bills/${n.invoiceId}`} className="font-medium text-brand hover:underline">
                            View bill
                          </Link>
                        )}
                        {n.paymentId && (
                          <Link href={`/billing/receipts/${n.paymentId}`} className="font-medium text-brand hover:underline">
                            View receipt
                          </Link>
                        )}
                      </div>
                    </div>
                    {!n.readAt && (
                      <Button type="button" size="sm" variant="ghost" onClick={() => markRead([n.id])} aria-label={`Mark "${n.title}" as read`}>
                        Mark as read
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Section
            title="Plans"
            description={`Charged monthly for each active student, with a minimum. Prices for ${s.usage.students.toLocaleString("en-PK")} students.${isOwner ? "" : " Only the school's owner can change the plan."}`}
          >
            <div className="grid gap-4 md:grid-cols-3">
              {s.plans.map((p) => {
                const current = p.code === s.plan.code;
                const label = current ? `Keep ${p.name} after the trial` : p.fits ? `Switch to ${p.name}` : "Too small for the school";
                const button = (
                  <Button
                    className="w-full"
                    type="button"
                    variant={current ? "primary" : "secondary"}
                    disabled={!p.fits || busy !== ""}
                    loading={busy === p.code}
                    onClick={() => setConfirming(p)}
                  >
                    {label}
                  </Button>
                );
                return (
                  <Card key={p.code} className={cn("flex flex-col", current && "border-primary ring-1 ring-primary")}>
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-base font-semibold text-fg">{p.name}</h3>
                      {current && <Badge tone="primary">Current</Badge>}
                    </div>
                    {p.description && <p className="mt-1 text-sm text-fg-muted">{p.description}</p>}
                    <p className="mt-4 font-display text-2xl font-semibold tabular-nums text-fg">
                      {rupees(p.estimate)}
                      <span className="text-sm font-normal text-fg-muted"> /month</span>
                    </p>
                    <p className="text-xs text-fg-muted">
                      Rs {p.pricePerStudent} a student, at least {rupees(p.minimumMonthly)}
                    </p>
                    <ul className="mt-4 flex flex-1 flex-col gap-2 border-t border-border pt-4 text-sm text-fg-secondary">
                      {[
                        p.maxStudents ? `Up to ${p.maxStudents.toLocaleString("en-PK")} students` : "Unlimited students",
                        p.maxCampuses ? `${p.maxCampuses} ${p.maxCampuses === 1 ? "campus" : "campuses"}` : "Unlimited campuses",
                        ...p.features,
                      ].map((f) => (
                        <li key={f} className="flex items-start gap-2">
                          <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                    {isOwner && !(current && s.status !== "TRIAL") && (
                      <div className="mt-5">
                        {p.fits ? (
                          button
                        ) : (
                          <Tooltip content="The school has more students or campuses than this plan allows">
                            <span className="block" tabIndex={0}>
                              {button}
                            </span>
                          </Tooltip>
                        )}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
            {error && (
              <Alert tone="danger" className="mt-4" onDismiss={() => setError("")}>
                {error}
              </Alert>
            )}
          </Section>

          <Card padding="none" className="overflow-hidden">
            <div className="p-4 pb-0 sm:p-5 sm:pb-0">
              <CardHeader
                title="Bills from SchoolSyncer"
                description="One bill at the start of each month. A bill is part paid until the whole amount has come in."
              />
            </div>
            <DataTable
              bare
              label="Bills from SchoolSyncer"
              columns={columns}
              data={s.invoices}
              getRowId={(i) => i.id}
              pageSize={12}
              empty={{
                icon: <ReceiptText />,
                title: "No bills yet",
                description: "The first one comes at the start of the month after the trial.",
              }}
            />
          </Card>

          <Card padding="none" className="overflow-hidden">
            <div className="p-4 pb-0 sm:p-5 sm:pb-0">
              <CardHeader title="Your payments" description="Money we have received from you, with a receipt for each." />
            </div>
            <DataTable
              bare
              label="Your payments to SchoolSyncer"
              columns={paymentColumns}
              data={s.payments}
              getRowId={(p) => p.id}
              pageSize={12}
              empty={{
                icon: <Wallet />,
                title: "No payments yet",
                description: "Once we receive a payment from you, its receipt shows up here.",
              }}
            />
          </Card>

          <ConfirmDialog
            open={!!confirming}
            onOpenChange={(o) => !o && busy === "" && setConfirming(null)}
            title={confirming ? `Move to the ${confirming.name} plan?` : ""}
            description={
              confirming
                ? `About ${rupees(confirming.estimate)} a month.${s.status === "TRIAL" ? " This ends the free trial and billing starts next month." : ""}`
                : ""
            }
            confirmLabel={confirming ? `Switch to ${confirming.name}` : "Switch"}
            loading={busy !== ""}
            onConfirm={() => confirming && choose(confirming)}
          />
        </>
      )}
    </div>
  );
}
