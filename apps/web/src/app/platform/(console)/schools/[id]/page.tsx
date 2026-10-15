"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  Ban,
  Building,
  ChevronDown,
  CircleX,
  CreditCard,
  History,
  LifeBuoy,
  MessageCircle,
  Phone,
  Receipt,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Store,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";
import {
  Alert,
  Avatar,
  Button,
  Card,
  CardHeader,
  DataTable,
  DescriptionList,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
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
import { auditIcon, auditLabel, auditReason } from "@/components/platform/audit-actions";
import { PilotHealthPanel } from "@/components/platform/pilot-health";
import { LifecycleDialog, type LifecycleAction } from "@/components/platform/lifecycle-dialog";
import { ReasonDialog } from "@/components/platform/reason-dialog";
import { SchoolFeatures, type FeatureState } from "@/components/platform/school-features";
import { SchoolPeople } from "@/components/platform/school-people";
import { isOwner, useConsoleAdmin, when } from "@/components/platform/session";
import { platformApi } from "@/lib/api";
import { day, rupees } from "@/lib/format";
import { usePlatformApi } from "@/lib/use-api";
import { whatsappNumber } from "@/components/students/directory-types";
import { monthName, StatusBadge, STATUS_OPTIONS, trialEnded } from "../../status";

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
  subscription:
    | (FeatureState & {
        plan: { code: string; name: string };
        status: string;
        trialEndsAt: string | null;
        notes: string | null;
        monthly: number;
        access: string;
        reason: string | null;
      })
    | null;
  invoices: {
    id: string;
    number: string;
    period: string;
    students: number;
    amount: number;
    status: string;
    dueDate: string;
    paidAt: string | null;
    method: string | null;
  }[];
  history: { id: string; action: string; createdAt: string; details: unknown; admin: { name: string } | null }[];
}

type Invoice = Detail["invoices"][number];

const DAY = 86_400_000;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * One line under the school name with what support needs when the school
 * calls: how its trial or bills stand, and a number to call back on.
 */
function AtAGlance({ s }: { s: Detail }) {
  const [now] = useState(() => Date.now());
  const parts: ReactNode[] = [];
  const sub = s.subscription;
  if (sub?.status === "TRIAL" && sub.trialEndsAt) {
    const days = Math.floor(Math.abs(now - +new Date(sub.trialEndsAt)) / DAY);
    parts.push(
      trialEnded(sub) ? (
        <span className="font-medium text-warning-text">
          Trial ended {day(sub.trialEndsAt)} ({days ? `${plural(days, "day")} ago` : "today"})
        </span>
      ) : (
        <span>
          Trial ends {day(sub.trialEndsAt)} (in {plural(Math.max(1, days), "day")})
        </span>
      ),
    );
  }
  const unpaid = s.invoices.filter((i) => i.status === "UNPAID");
  if (unpaid.length) {
    const owed = unpaid.reduce((a, i) => a + i.amount, 0);
    const oldest = unpaid.reduce((a, i) => (i.dueDate < a.dueDate ? i : a));
    const late = Math.floor((now - +new Date(oldest.dueDate)) / DAY);
    parts.push(
      <span className={late > 0 ? "font-medium text-danger-text" : undefined}>
        Owes {rupees(owed)} on {plural(unpaid.length, "bill")}, oldest due {day(oldest.dueDate)}
        {late > 0 && ` (${plural(late, "day")} overdue)`}
      </span>,
    );
  }
  // The school's own number, else the first owner's.
  const ownerPhone = s.owners.find((o) => o.phone)?.phone;
  const contact = s.phone ? { phone: s.phone, who: "School" } : ownerPhone ? { phone: ownerPhone, who: "Owner" } : null;
  if (contact) {
    const mobile = /^(0|\+?92)3\d{9}$/.test(contact.phone.replace(/[\s-]/g, ""));
    parts.push(
      <span className="inline-flex items-center gap-3">
        <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 text-fg-secondary hover:text-brand">
          <Phone className="size-3.5" aria-hidden />
          {contact.who} {contact.phone}
        </a>
        {mobile && (
          <a
            href={`https://wa.me/${whatsappNumber(contact.phone)}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-fg-secondary hover:text-brand"
          >
            <MessageCircle className="size-3.5" aria-hidden />
            WhatsApp
          </a>
        )}
      </span>,
    );
  }
  if (!parts.length) return null;
  return (
    <div className="flex basis-full flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-fg-muted">
      {parts.map((p, i) => (
        <span key={i} className="inline-flex items-center gap-2">
          {i > 0 && <span aria-hidden>·</span>}
          {p}
        </span>
      ))}
    </div>
  );
}

const ACCESS: Record<string, { tone: Tone; label: string }> = {
  full: { tone: "success", label: "Full access" },
  read_only: { tone: "warning", label: "Read-only" },
  blocked: { tone: "danger", label: "Blocked" },
};

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
  const admin = useConsoleAdmin();
  const owner = isOwner(admin);
  const toast = useToast();
  const [supportOpen, setSupportOpen] = useState(false);
  const [lifecycle, setLifecycle] = useState<LifecycleAction | null>(null);
  const sub = school.data?.subscription;

  /**
   * Opens the school app in a new tab with a one-hour owner session. The tab is
   * opened before the request so pop-up blockers allow it; the token travels in
   * the URL hash, which never reaches a server, and lives only in that tab.
   */
  async function startSupport(reason: string) {
    const tab = window.open("about:blank", "_blank");
    try {
      const res = await platformApi<{ accessToken: string; expiresAt: string }>(`/schools/${id}/support-login`, { method: "POST", body: { reason } });
      const hash = new URLSearchParams({ token: res.accessToken, school: school.data?.name ?? "", expires: res.expiresAt }).toString();
      const url = `${window.location.origin}/support#${hash}`;
      if (tab) tab.location.href = url;
      else window.open(url, "_blank");
      toast.success("Support session started", "It ends after an hour or when you end it in the school tab.");
      void school.reload();
    } catch (e) {
      tab?.close();
      throw e;
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
            <StatusBadge status={sub && trialEnded(sub) ? "TRIAL_ENDED" : (sub?.status ?? null)} />
            {sub && <span className="text-[13px] text-fg-muted">{sub.plan.name} plan</span>}
            <AtAGlance s={s} />
          </>
        }
        actions={
          <>
            {sub && (
              <DropdownMenu
                trigger={
                  <Button type="button" variant="secondary" iconRight={<ChevronDown />}>
                    Account status
                  </Button>
                }
              >
                {sub.status === "SUSPENDED" || sub.status === "CANCELLED" ? (
                  <DropdownItem icon={<RotateCcw />} onSelect={() => setLifecycle("reactivate")} description="Give the school full access again">
                    Reactivate
                  </DropdownItem>
                ) : (
                  <DropdownItem icon={<Ban />} onSelect={() => setLifecycle("suspend")} description="Stop access until reactivated">
                    Suspend
                  </DropdownItem>
                )}
                {sub.status !== "CANCELLED" && (
                  <>
                    <DropdownSeparator />
                    <DropdownItem
                      icon={<CircleX />}
                      danger
                      disabled={!owner}
                      disabledReason="Only a SchoolSyncer owner can close a school"
                      onSelect={() => setLifecycle("cancel")}
                    >
                      Close school
                    </DropdownItem>
                  </>
                )}
              </DropdownMenu>
            )}
            <Button type="button" icon={<LifeBuoy />} onClick={() => setSupportOpen(true)}>
              Support session
            </Button>
          </>
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
          { value: "people", label: "People", icon: <Users /> },
          { value: "pilot", label: "Pilot health", icon: <Activity /> },
          { value: "features", label: "Plan & features", icon: <SlidersHorizontal />, disabled: !sub },
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

        <TabPanel value="people" className="pt-5">
          <SchoolPeople schoolId={s.id} schoolName={s.name} campuses={s.campuses} />
        </TabPanel>

        <TabPanel value="pilot" className="pt-5">
          <PilotHealthPanel schoolId={s.id} />
        </TabPanel>

        <TabPanel value="features" className="pt-5">
          {sub && (
            <SchoolFeatures
              key={`${sub.plan.code}:${sub.features.join()}`}
              schoolId={s.id}
              planName={sub.plan.name}
              state={sub}
              canEdit={owner}
              onSaved={school.reload}
            />
          )}
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
            <CardHeader
              title="History"
              description="Changes made from the console, newest first."
              action={
                <Link href={`/platform/audit?schoolId=${s.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
                  Full audit log
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              }
            />
            {s.history.length === 0 ? (
              <EmptyState icon={<History />} title="Nothing yet" description="Console changes to this school are recorded here." compact />
            ) : (
              <ol className="relative flex flex-col gap-5 border-s border-border ps-6">
                {s.history.map((h) => {
                  const Icon = auditIcon(h.action);
                  const reason = auditReason(h.details);
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
                          {auditLabel(h.action)}
                          {h.admin && <span className="text-fg-muted"> by {h.admin.name}</span>}
                        </span>
                        <time dateTime={h.createdAt} className="text-[13px] tabular-nums text-fg-muted">
                          {when(h.createdAt)}
                        </time>
                      </div>
                      {reason && <p className="mt-1 text-[13px] text-fg-secondary">Reason: {reason}</p>}
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
        </TabPanel>
      </Tabs>

      <ReasonDialog
        open={supportOpen}
        onOpenChange={setSupportOpen}
        title={`Start a support session at ${s.name}?`}
        description="Opens the school app in a new tab, signed in as the owner for one hour. The school's own audit log records it with your reason."
        confirmLabel="Start session"
        reasonLabel="Why do you need access?"
        placeholder="Owner asked for help setting up the October fee vouchers (ticket 4821)"
        onSubmit={startSupport}
      />

      <LifecycleDialog action={lifecycle} schoolId={s.id} schoolName={s.name} onOpenChange={(o) => !o && setLifecycle(null)} onDone={school.reload} />
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
