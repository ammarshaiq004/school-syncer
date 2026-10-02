"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Card, ErrorText, Notice, rowClass, tableClass } from "@/components/ui";
import { platformApi, setToken } from "@/lib/api";
import { day, rupees } from "@/lib/format";
import { usePlatformApi } from "@/lib/use-api";
import { monthName, StatusBadge, STATUSES } from "../../status";

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

const ACTIONS: Record<string, string> = {
  "subscription.update": "Changed the subscription",
  "school.support_login": "Signed in as the owner for support",
  "invoice.pay": "Recorded a payment",
  "invoice.void": "Voided a bill",
};

const selectClass = "rounded-lg border border-black/15 bg-transparent px-3 py-2 dark:border-white/20";

export default function SchoolDetailPage() {
  const { id } = useParams<{ id: string }>();
  const school = usePlatformApi<Detail>(`/schools/${id}`);
  const plans = usePlatformApi<{ plans: { code: string; name: string }[] }>("/plans");
  const [error, setError] = useState("");
  const sub = school.data?.subscription;

  async function supportLogin() {
    if (!confirm(`Sign in to ${school.data?.name} as its owner for an hour? This is recorded in the school's audit log.`)) return;
    try {
      const res = await platformApi<{ accessToken: string }>(`/schools/${id}/support-login`, { method: "POST" });
      setToken(res.accessToken);
      window.open("/dashboard", "_blank");
      await school.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const s = school.data;
  if (!s) return <ErrorText>{school.error}</ErrorText>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/platform/schools" className="text-sm text-brand">← Schools</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{s.name}</h1>
          <StatusBadge status={sub?.status ?? null} />
          <Button variant="ghost" className="ml-auto" onClick={supportLogin}>Sign in as owner</Button>
        </div>
        <p className="text-sm opacity-70">
          School code {s.slug}{s.city && ` · ${s.city}`} · joined {day(s.createdAt)}
          {s.email && ` · ${s.email}`}{s.phone && ` · ${s.phone}`}
        </p>
        <ErrorText>{error}</ErrorText>
        {sub?.reason && <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">The school sees: “{sub.reason}”</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Active students", s.usage.students],
          ["Staff logins", s.usage.staff],
          ["Parent logins", s.usage.parents],
          ["Campuses", s.campuses.length],
          ["Per month", sub ? rupees(sub.monthly) : "–"],
        ].map(([label, value]) => (
          <Card key={label as string}>
            <div className="text-sm opacity-60">{label}</div>
            <div className="mt-1 text-xl font-semibold">{typeof value === "number" ? value.toLocaleString("en-PK") : value}</div>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <Card>
          <h2 className="mb-3 font-semibold">Subscription</h2>
          {sub ? (
            <SubscriptionForm
              key={`${sub.plan.code}${sub.status}${sub.trialEndsAt}${sub.notes}`}
              schoolId={s.id}
              sub={sub}
              plans={plans.data?.plans ?? []}
              onSaved={school.reload}
            />
          ) : (
            <p className="text-sm opacity-70">This school has no subscription, so nobody there can sign in.</p>
          )}

          <h2 className="mb-2 mt-6 font-semibold">Owners</h2>
          <ul className="space-y-2 text-sm">
            {s.owners.map((o) => (
              <li key={o.id}>
                <div className="font-medium">{o.name}</div>
                <div className="opacity-70">{[o.email, o.phone].filter(Boolean).join(" · ")}</div>
                <div className="text-xs opacity-60">Last signed in {o.lastLoginAt ? day(o.lastLoginAt) : "never"}</div>
              </li>
            ))}
          </ul>
        </Card>

        <div className="flex flex-col gap-6">
          <Card className="overflow-x-auto">
            <h2 className="mb-3 font-semibold">Bills</h2>
            {s.invoices.length === 0 ? (
              <p className="text-sm opacity-60">No bills yet.</p>
            ) : (
              <table className={tableClass}>
                <thead className="opacity-60">
                  <tr><th className="py-2">Bill</th><th>Month</th><th>Students</th><th>Amount</th><th>Due</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {s.invoices.map((i) => (
                    <tr key={i.id} className={rowClass}>
                      <td className="py-2 font-mono text-xs">{i.number}</td>
                      <td>{monthName(i.period)}</td>
                      <td>{i.students}</td>
                      <td>{rupees(i.amount)}</td>
                      <td>{day(i.dueDate)}</td>
                      <td>
                        <StatusBadge status={i.status} />
                        {i.paidAt && <span className="ml-2 text-xs opacity-60">{day(i.paidAt)}, {i.method}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <Link href="/platform/invoices" className="mt-3 inline-block text-sm text-brand">Record a payment on the Bills page</Link>
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">History</h2>
            {s.history.length === 0 ? (
              <p className="text-sm opacity-60">Nothing yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {s.history.map((h) => (
                  <li key={h.id} className="flex flex-wrap justify-between gap-2">
                    <span>{ACTIONS[h.action] ?? h.action}{h.admin && <span className="opacity-60"> by {h.admin.name}</span>}</span>
                    <span className="opacity-60">{new Date(h.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function SubscriptionForm({
  schoolId,
  sub,
  plans,
  onSaved,
}: {
  schoolId: string;
  sub: NonNullable<Detail["subscription"]>;
  plans: { code: string; name: string }[];
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    planCode: sub.plan.code,
    status: sub.status,
    trialEndsAt: sub.trialEndsAt?.slice(0, 10) ?? "",
    notes: sub.notes ?? "",
  });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await platformApi(`/schools/${schoolId}/subscription`, {
        method: "PATCH",
        body: { ...form, trialEndsAt: form.trialEndsAt || null, notes: form.notes || null },
      });
      setNotice("Saved. The school sees the change within a few seconds.");
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3 text-sm">
      <label className="flex flex-col gap-1">
        <span className="font-medium">Plan</span>
        <select className={selectClass} value={form.planCode} onChange={(e) => setForm({ ...form, planCode: e.target.value })}>
          {plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium">Status</span>
        <select className={selectClass} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
          {STATUSES.map((st) => <option key={st} value={st}>{st.replace("_", " ").toLowerCase()}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium">Trial ends</span>
        <input type="date" className={selectClass} value={form.trialEndsAt} onChange={(e) => setForm({ ...form, trialEndsAt: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium">Notes (staff only)</span>
        <textarea className={selectClass} rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </label>
      <ErrorText>{error}</ErrorText>
      <Notice>{notice}</Notice>
      <Button type="submit">Save</Button>
    </form>
  );
}
