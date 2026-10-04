"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowRight, Building, CreditCard, History, LogIn, Receipt, ShieldCheck, Store, UserRound, Users, Wallet } from "lucide-react";
import {
  Alert,
  Avatar,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  DataTable,
  DescriptionList,
  EmptyState,
  ErrorState,
  KpiCard,
  PageHeader,
  SelectField,
  Skeleton,
  SkeletonCards,
  StatGrid,
  StatusPill,
  TabPanel,
  Tabs,
  TextareaField,
  TextField,
  useToast,
  type Column,
  type Tone,
} from "@/components/ui";
import { platformApi, setToken } from "@/lib/api";
import { day, rupees } from "@/lib/format";
import { usePlatformApi } from "@/lib/use-api";
import { monthName, StatusBadge, STATUS_OPTIONS } from "../../status";

interface Detail {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  phone: string | null;
  email: string | null;
  createdAt: string;
  campuses: { id: string; name: string }[];
  owners: { id: string; name: string; email: string | null; phone: string | null; lastLoginAt: string | null }[];
  usage: { students: number; staff: number; parents: number; lastLoginAt: string | null };
  subscription: {
    plan: { code: string; name: string };
    status: string;
    trialEndsAt: string | null;
    notes: string | null;
    monthly: number;
    access: string;
    reason: string | null;
  } | null;
  invoices: { id: string; number: string; period: string; students: number; amount: number; status: string; dueDate: string; paidAt: string | null; method: string | null }[];
  history: { id: string; action: string; createdAt: string; details: unknown; admin: { name: string } | null }[];
}

type Invoice = Detail["invoices"][number];

const ACTIONS: Record<string, string> = {
  "subscription.update": "Changed the subscription",
  "school.support_login": "Signed in as the owner for support",
  "invoice.pay": "Recorded a payment",
  "invoice.void": "Voided a bill",
};

const ACTION_ICONS: Record<string, typeof History> = {
  "subscription.update": CreditCard,
  "school.support_login": LogIn,
  "invoice.pay": Wallet,
  "invoice.void": Receipt,
};

const ACCESS: Record<string, { tone: Tone; label: string }> = {
  full: { tone: "success", label: "Full access" },
  read_only: { tone: "warning", label: "Read-only" },
  blocked: { tone: "danger", label: "Blocked" },
};

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

const invoiceColumns: Column<Invoice>[] = [
  { id: "number", header: "Bill", sortValue: (i) => i.number, cell: (i) => <span className="font-mono text-xs">{i.number}</span> },
  { id: "period", header: "Month", sortValue: (i) => i.period, cell: (i) => monthName(i.period) },
  { id: "students", header: "Students", align: "right", sortValue: (i) => i.students, cell: (i) => i.students, hideBelow: "sm" },
  { id: "amount", header: "Amount", align: "right", sortValue: (i) => i.amount, cell: (i) => rupees(i.amount) },
  { id: "due", header: "Due", sortValue: (i) => i.dueDate, cell: (i) => day(i.dueDate), hideBelow: "md" },
  {
    id: "status",
    header: "Status",
    sortValue: (i) => i.status,
    cell: (i) => (
      <span className="flex flex-col items-start gap-0.5">
        <StatusBadge status={i.status} />
        {i.paidAt && (
          <span className="text-xs text-fg-muted">
            {day(i.paidAt)}, {i.method}
          </span>
        )}
      </span>
    ),
  },
];

export default function SchoolDetailPage() {
  const { id } = useParams<{ id: string }>();
  const school = usePlatformApi<Detail>(`/schools/${id}`);
  const plans = usePlatformApi<{ plans: { code: string; name: string }[] }>("/plans");
  const toast = useToast();
  const [confirmLogin, setConfirmLogin] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const sub = school.data?.subscription;

  async function supportLogin() {
    setSigningIn(true);
    try {
      const res = await platformApi<{ accessToken: string }>(`/schools/${id}/support-login`, { method: "POST" });
      setToken(res.accessToken);
      window.open("/dashboard", "_blank");
      setConfirmLogin(false);
      await school.reload();
    } catch (e) {
      toast.error("Could not sign in as the owner", (e as Error).message);
    } finally {
      setSigningIn(false);
    }
  }

  const s = school.data;
  const crumbs = [{ label: "Schools", href: "/platform/schools" }, { label: s?.name ?? "School" }];

  if (!s) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={school.error ? "School" : <Skeleton className="h-7 w-56" />} breadcrumbs={crumbs} />
        {school.error ? (
          <Card padding="none">
            <ErrorState message={school.error} onRetry={school.reload} />
          </Card>
        ) : (
          <>
            <SkeletonCards count={5} />
            <Skeleton className="h-72 w-full rounded-xl" />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={s.name}
        breadcrumbs={crumbs}
        leading={<Avatar name={s.name} size="lg" />}
        description={[`School code ${s.slug}`, s.city, `joined ${day(s.createdAt)}`].filter(Boolean).join(", ")}
        meta={
          <>
            <StatusBadge status={sub?.status ?? null} />
            {sub && <span className="text-[13px] text-fg-muted">{sub.plan.name} plan</span>}
          </>
        }
        actions={
          <Button variant="secondary" icon={<LogIn />} onClick={() => setConfirmLogin(true)}>
            Sign in as owner
          </Button>
        }
      />

      {sub?.reason && (
        <Alert tone="warning" title="The school sees this message">
          {sub.reason}
        </Alert>
      )}

      <StatGrid cols={5}>
        <KpiCard label="Active students" value={s.usage.students.toLocaleString("en-PK")} icon={<Users />} />
        <KpiCard label="Staff logins" value={s.usage.staff.toLocaleString("en-PK")} icon={<UserRound />} tone="info" />
        <KpiCard label="Parent logins" value={s.usage.parents.toLocaleString("en-PK")} icon={<Users />} tone="info" />
        <KpiCard label="Campuses" value={s.campuses.length.toLocaleString("en-PK")} icon={<Store />} tone="neutral" />
        <KpiCard label="Per month" value={sub ? rupees(sub.monthly) : "–"} icon={<Wallet />} tone="success" />
      </StatGrid>

      <Tabs
        aria-label="School sections"
        tabs={[
          { value: "overview", label: "Overview", icon: <Building /> },
          { value: "subscription", label: "Subscription", icon: <CreditCard /> },
          { value: "invoices", label: "Invoices", icon: <Receipt />, count: s.invoices.length },
          { value: "audit", label: "Audit", icon: <History />, count: s.history.length },
        ]}
      >
        <TabPanel value="overview" className="pt-5">
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="School details" />
              <DescriptionList
                items={[
                  { label: "School code", value: <span className="font-mono text-[13px]">{s.slug}</span> },
                  { label: "City", value: s.city },
                  { label: "Email", value: s.email },
                  { label: "Phone", value: s.phone },
                  { label: "Joined", value: day(s.createdAt) },
                  { label: "Last sign-in by anyone", value: s.usage.lastLoginAt ? day(s.usage.lastLoginAt) : "Never" },
                  {
                    label: "Campuses",
                    full: true,
                    value: s.campuses.length ? s.campuses.map((c) => c.name).join(", ") : "None",
                  },
                ]}
              />
            </Card>
            <Card>
              <CardHeader title="Owners" icon={<ShieldCheck />} />
              {s.owners.length === 0 ? (
                <EmptyState title="No owners" description="This school has no owner account." compact />
              ) : (
                <ul className="divide-y divide-border">
                  {s.owners.map((o) => (
                    <li key={o.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                      <Avatar name={o.name} size="sm" />
                      <div className="min-w-0 text-sm">
                        <div className="font-medium text-fg">{o.name}</div>
                        <div className="break-words text-fg-secondary">{[o.email, o.phone].filter(Boolean).join(", ")}</div>
                        <div className="text-xs text-fg-muted">Last signed in {o.lastLoginAt ? day(o.lastLoginAt) : "never"}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </TabPanel>

        <TabPanel value="subscription" className="pt-5">
          <Card className="max-w-2xl">
            <CardHeader title="Subscription" description="Plan, status and trial date for this school." />
            {sub ? (
              <SubscriptionForm
                key={`${sub.plan.code}${sub.status}${sub.trialEndsAt}${sub.notes}`}
                schoolId={s.id}
                sub={sub}
                plans={plans.data?.plans ?? []}
                plansError={plans.error}
                onSaved={school.reload}
              />
            ) : (
              <EmptyState title="No subscription" description="This school has no subscription, so nobody there can sign in." compact />
            )}
          </Card>
        </TabPanel>

        <TabPanel value="invoices" className="pt-5">
          <div className="flex flex-col gap-3">
            <DataTable
              label="Bills"
              columns={invoiceColumns}
              data={s.invoices}
              getRowId={(i) => i.id}
              pageSize={10}
              empty={{ icon: <Receipt />, title: "No bills yet", description: "Bills appear once this school is billed for a month." }}
            />
            <Link href="/platform/invoices" className="inline-flex w-fit items-center gap-1 text-sm font-medium text-brand hover:underline">
              Record a payment on the Bills page
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </div>
        </TabPanel>

        <TabPanel value="audit" className="pt-5">
          <Card>
            <CardHeader title="History" description="Changes made from the console, newest first." />
            {s.history.length === 0 ? (
              <EmptyState icon={<History />} title="Nothing yet" description="Console changes to this school are recorded here." compact />
            ) : (
              <ol className="relative flex flex-col gap-5 border-s border-border ps-6">
                {s.history.map((h) => {
                  const Icon = ACTION_ICONS[h.action] ?? History;
                  return (
                    <li key={h.id} className="relative">
                      <span
                        className="absolute -start-[37px] top-0 grid size-6 place-items-center rounded-full border border-border bg-surface text-fg-muted [&_svg]:size-3.5"
                        aria-hidden
                      >
                        <Icon />
                      </span>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-sm">
                        <span className="text-fg">
                          {ACTIONS[h.action] ?? h.action}
                          {h.admin && <span className="text-fg-muted"> by {h.admin.name}</span>}
                        </span>
                        <time dateTime={h.createdAt} className="text-[13px] tabular-nums text-fg-muted">
                          {when(h.createdAt)}
                        </time>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
        </TabPanel>
      </Tabs>

      <ConfirmDialog
        open={confirmLogin}
        onOpenChange={setConfirmLogin}
        title={`Sign in to ${s.name} as its owner?`}
        description="You get the owner's access for an hour in a new tab. This is recorded in the school's audit log."
        confirmLabel="Sign in as owner"
        loading={signingIn}
        onConfirm={supportLogin}
      />
    </div>
  );
}

function SubscriptionForm({
  schoolId,
  sub,
  plans,
  plansError,
  onSaved,
}: {
  schoolId: string;
  sub: NonNullable<Detail["subscription"]>;
  plans: { code: string; name: string }[];
  plansError: string;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    planCode: sub.plan.code,
    status: sub.status,
    trialEndsAt: sub.trialEndsAt?.slice(0, 10) ?? "",
    notes: sub.notes ?? "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      await platformApi(`/schools/${schoolId}/subscription`, {
        method: "PATCH",
        body: { ...form, trialEndsAt: form.trialEndsAt || null, notes: form.notes || null },
      });
      toast.success("Subscription saved", "The school sees the change within a few seconds.");
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const planOptions = plans.length ? plans.map((p) => ({ value: p.code, label: p.name })) : [{ value: sub.plan.code, label: sub.plan.name }];

  return (
    <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
      <SelectField
        label="Plan"
        options={planOptions}
        value={form.planCode}
        onChange={(e) => setForm({ ...form, planCode: e.target.value })}
        error={plansError ? `Could not load plans: ${plansError}` : undefined}
      />
      <SelectField label="Status" options={STATUS_OPTIONS} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} />
      <TextField
        label="Trial ends"
        type="date"
        value={form.trialEndsAt}
        onChange={(e) => setForm({ ...form, trialEndsAt: e.target.value })}
        hint="Leave empty for no trial end date."
      />
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-fg-secondary">Access now</span>
        <span className="flex h-9 items-center">
          <StatusPill status={sub.access} {...(ACCESS[sub.access] ?? { tone: "neutral" })} />
        </span>
      </div>
      <TextareaField
        label="Notes (staff only)"
        rows={3}
        value={form.notes}
        onChange={(e) => setForm({ ...form, notes: e.target.value })}
        wrapperClassName="sm:col-span-2"
      />
      {error && (
        <Alert tone="danger" className="sm:col-span-2">
          {error}
        </Alert>
      )}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="submit" loading={saving}>
          Save subscription
        </Button>
      </div>
    </form>
  );
}
