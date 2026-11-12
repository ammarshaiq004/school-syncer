"use client";

import Link from "next/link";
import { useState } from "react";
import { Cake, CircleDollarSign, HandCoins, Receipt, TicketCheck, UserMinus, UserPlus, Users } from "lucide-react";
import { Card, CardHeader, DonutChart, ProgressBar, Skeleton } from "@/components/ui";
import { SegmentedControl } from "@/components/kit/tabs";
import { rupees } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { SectionState, ViewAll } from "./shared";

export interface WidgetData {
  genderSplit?: { male: number; female: number; other: number };
  students: number;
  withdrawalsThisMonth?: number;
  birthdaysToday?: { id: string; name: string; admissionNo: string; turns: number }[];
  challans?: { period: string; paid: number; partial: number; unpaid: number; total: number } | null;
  expenses?: { thisMonth: number; lastMonth: number } | null;
  complaintsOpen?: number;
  commitments?: { dueToday: { id: string; studentId: string; student: { firstName: string; lastName: string | null }; amount: number; paid: number; status: string }[]; broken: number } | null;
  staffWithoutDesignation?: number;
}

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 1000) / 10 : 0);

export function GenderSplitCard({ s }: { s?: WidgetData }) {
  const g = s?.genderSplit;
  const total = g ? g.male + g.female + g.other : 0;
  return (
    <Card>
      <CardHeader title="Boys and girls" description="Active students" icon={<Users />} />
      {!g ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <DonutChart
          label="Gender split of active students"
          size={128}
          centerValue={total.toLocaleString("en-PK")}
          centerLabel="students"
          formatValue={(n) => `${n} (${pct(n, total)}%)`}
          data={[
            { label: "Boys", value: g.male, color: "var(--chart-1)" },
            { label: "Girls", value: g.female, color: "var(--chart-3)" },
            ...(g.other ? [{ label: "Not specified", value: g.other, color: "var(--chart-6)" }] : []),
          ]}
        />
      )}
    </Card>
  );
}

const RANGES = [
  { value: "month", label: "This month" },
  { value: "year", label: "This year" },
  { value: "last", label: "Last year" },
] as const;
type Range = (typeof RANGES)[number]["value"];

function rangeOf(r: Range, today = new Date()) {
  const y = today.getFullYear();
  const iso = (d: Date) => d.toLocaleDateString("en-CA");
  if (r === "month") return { from: iso(new Date(y, today.getMonth(), 1)), to: iso(today) };
  if (r === "year") return { from: `${y}-01-01`, to: iso(today) };
  return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
}

export function AdmissionsWithdrawalsCard() {
  const [range, setRange] = useState<Range>("month");
  const { from, to } = rangeOf(range);
  const r = useApi<{ totals: { admitted: number; withdrawn: number } }>(`/reports/admissions-withdrawals?from=${from}&to=${to}`);
  const t = r.data?.totals;
  const net = t ? t.admitted - t.withdrawn : 0;
  return (
    <Card>
      <CardHeader
        title="Admissions and withdrawals"
        icon={<UserPlus />}
        action={<SegmentedControl aria-label="Period" value={range} onChange={setRange} options={[...RANGES]} />}
      />
      {!t ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <dl className="grid grid-cols-3 gap-3 text-center">
          <div>
            <dt className="flex items-center justify-center gap-1 text-xs text-fg-muted"><UserPlus className="size-3.5" aria-hidden />Admissions</dt>
            <dd className="font-display text-xl font-semibold tabular-nums text-success-text">{t.admitted}</dd>
          </div>
          <div>
            <dt className="flex items-center justify-center gap-1 text-xs text-fg-muted"><UserMinus className="size-3.5" aria-hidden />Withdrawals</dt>
            <dd className="font-display text-xl font-semibold tabular-nums text-danger-text">{t.withdrawn}</dd>
          </div>
          <div>
            <dt className="text-xs text-fg-muted">Net growth</dt>
            <dd className="font-display text-xl font-semibold tabular-nums">{net > 0 ? `+${net}` : net}</dd>
          </div>
        </dl>
      )}
    </Card>
  );
}

export function BirthdaysCard({ s, loading, error, onRetry }: { s?: WidgetData; loading: boolean; error: string; onRetry: () => void }) {
  return (
    <Card>
      <CardHeader title="Birthdays today" description="Active students" icon={<Cake />} />
      <SectionState
        data={loading ? null : (s?.birthdaysToday ?? [])}
        error={error}
        onRetry={onRetry}
        rows={2}
        empty={{ title: "No birthdays today", description: "Students with a birthday today show here.", icon: <Cake /> }}
      >
        {(list) => (
          <ul className="-my-2 divide-y divide-border">
            {list.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <Link href={`/students/${b.id}`} className="truncate font-medium text-fg hover:text-brand">{b.name}</Link>
                <span className="shrink-0 text-xs text-fg-muted">turns {b.turns}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionState>
    </Card>
  );
}

export function VoucherStatusCard({ s }: { s?: WidgetData }) {
  const c = s?.challans;
  if (c === null) return null;
  return (
    <Card>
      <CardHeader title="Voucher status" description={c ? `Students' vouchers for ${c.period}, arrears included` : undefined} icon={<Receipt />} action={<ViewAll href="/fees" />} />
      {!c ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-3 gap-3 text-center">
            {[
              { k: "Paid", n: c.paid, tone: "text-success-text" },
              { k: "Partial", n: c.partial, tone: "text-warning-text" },
              { k: "Unpaid", n: c.unpaid, tone: "text-danger-text" },
            ].map((x) => (
              <div key={x.k}>
                <dt className="text-xs text-fg-muted">{x.k}</dt>
                <dd className={`font-display text-xl font-semibold tabular-nums ${x.tone}`}>{x.n}</dd>
                <dd className="text-xs text-fg-muted">{pct(x.n, c.total)}%</dd>
              </div>
            ))}
          </dl>
          <ProgressBar label="Fully paid" value={c.paid} max={c.total || 1} valueText={`${pct(c.paid, c.total)}% fully paid`} tone="success" />
        </div>
      )}
    </Card>
  );
}

export function ExpensesCard({ s }: { s?: WidgetData }) {
  const e = s?.expenses;
  if (e === null) return null;
  const change = e && e.lastMonth ? Math.round(((e.thisMonth - e.lastMonth) / e.lastMonth) * 100) : null;
  return (
    <Card>
      <CardHeader title="Expenses" description="This month against last month" icon={<CircleDollarSign />} action={<ViewAll href="/accounts" />} />
      {!e ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <dl className="grid grid-cols-2 gap-3">
          <div>
            <dt className="text-xs text-fg-muted">This month</dt>
            <dd className="font-display text-xl font-semibold tabular-nums">{rupees(e.thisMonth)}</dd>
            {change !== null && <dd className="text-xs text-fg-muted">{change > 0 ? `${change}% more` : change < 0 ? `${-change}% less` : "Same"} than last month</dd>}
          </div>
          <div>
            <dt className="text-xs text-fg-muted">Last month</dt>
            <dd className="font-display text-xl font-semibold tabular-nums text-fg-muted">{rupees(e.lastMonth)}</dd>
          </div>
        </dl>
      )}
    </Card>
  );
}

export function ComplaintsCard({ s }: { s?: WidgetData }) {
  return (
    <Card>
      <CardHeader title="New complaints" description="Waiting to be looked at" icon={<TicketCheck />} action={<ViewAll href="/front-office" />} />
      {s ? <p className="font-display text-2xl font-semibold tabular-nums">{s.complaintsOpen ?? 0}</p> : <Skeleton className="h-8 w-16" />}
    </Card>
  );
}

export function CommitmentsCard({ s }: { s?: WidgetData }) {
  const c = s?.commitments;
  if (c === null) return null;
  return (
    <Card>
      <CardHeader title="Today's fee commitments" description="Parents who promised to pay today" icon={<HandCoins />} action={<ViewAll href="/fees#defaulters" label="Defaulters" />} />
      {!c ? (
        <Skeleton className="h-16 w-full" />
      ) : c.dueToday.length === 0 ? (
        <p className="text-sm text-fg-muted">No promises fall due today.{c.broken ? ` ${c.broken} earlier promise${c.broken === 1 ? " was" : "s were"} broken.` : ""}</p>
      ) : (
        <>
          <ul className="-my-2 divide-y divide-border">
            {c.dueToday.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <Link href={`/students/${x.studentId}`} className="truncate font-medium text-fg hover:text-brand">
                  {[x.student.firstName, x.student.lastName].filter(Boolean).join(" ")}
                </Link>
                <span className={x.status === "KEPT" ? "shrink-0 text-success-text" : "shrink-0 tabular-nums"}>
                  {x.status === "KEPT" ? "Paid " : ""}
                  {rupees(x.amount)}
                </span>
              </li>
            ))}
          </ul>
          {c.broken > 0 && <p className="mt-3 text-xs text-danger-text">{c.broken} earlier promise{c.broken === 1 ? " was" : "s were"} broken.</p>}
        </>
      )}
    </Card>
  );
}
