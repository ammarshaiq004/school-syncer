"use client";

import { useState } from "react";
import { Building, CalendarClock, Check, CircleAlert, CreditCard, ReceiptText, Users } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  DataTable,
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
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { day, rupees } from "@/lib/format";
import { hasRole, useSession } from "@/lib/session";
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

interface Invoice {
  id: string;
  number: string;
  period: string;
  planName: string;
  students: number;
  amount: number;
  status: "UNPAID" | "PAID" | "VOID";
  dueDate: string;
  paidAt: string | null;
  method: string | null;
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
}

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

  const s = sub.data;
  const unpaid = s?.invoices.filter((i) => i.status === "UNPAID") ?? [];
  const owed = unpaid.reduce((a, i) => a + i.amount, 0);
  const status = s ? STATUS[s.status] : undefined;

  const columns: Column<Invoice>[] = [
    { id: "number", header: "Bill", sortValue: (i) => i.number, cell: (i) => <span className="font-mono text-xs font-medium text-fg">{i.number}</span> },
    { id: "period", header: "Month", sortValue: (i) => i.period, cell: (i) => monthName(i.period) },
    { id: "plan", header: "Plan", cell: (i) => i.planName, hideBelow: "md" },
    { id: "students", header: "Students", align: "right", sortValue: (i) => i.students, cell: (i) => i.students.toLocaleString("en-PK"), hideBelow: "md" },
    { id: "amount", header: "Amount", align: "right", sortValue: (i) => i.amount, cell: (i) => <span className="font-medium text-fg">{rupees(i.amount)}</span> },
    { id: "due", header: "Due", sortValue: (i) => i.dueDate, cell: (i) => day(i.dueDate), hideBelow: "sm" },
    {
      id: "status",
      header: "Status",
      cell: (i) =>
        i.status === "PAID" ? (
          <StatusPill status="PAID" label={i.paidAt ? `Paid ${day(i.paidAt)}` : "Paid"} />
        ) : i.status === "VOID" ? (
          <StatusPill status="CANCELLED" label="Cancelled" />
        ) : i.dueDate.slice(0, 10) < new Date().toLocaleDateString("en-CA") ? (
          <StatusPill status="OVERDUE" />
        ) : (
          <StatusPill status="UNPAID" />
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
          {unpaid.length > 0 && (
            <Alert tone="warning" icon={<CircleAlert />} title={`${rupees(owed)} owed to SchoolSyncer`}>
              Pay by bank transfer or JazzCash and send the receipt to SchoolSyncer support with the bill number.
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
              <CardHeader title="Bills from SchoolSyncer" description="One bill at the start of each month." />
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
