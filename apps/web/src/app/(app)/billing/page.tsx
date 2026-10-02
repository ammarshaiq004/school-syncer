"use client";

import { useState } from "react";
import { Badge, Button, Card, ErrorText, Notice, PageTitle, rowClass, tableClass } from "@/components/ui";
import { api } from "@/lib/api";
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

const STATUS: Record<string, { label: string; tone: "green" | "amber" | "red" | "blue" }> = {
  TRIAL: { label: "Free trial", tone: "blue" },
  ACTIVE: { label: "Active", tone: "green" },
  PAST_DUE: { label: "Payment overdue", tone: "amber" },
  SUSPENDED: { label: "Suspended", tone: "red" },
  CANCELLED: { label: "Cancelled", tone: "red" },
};

const monthName = (period: string) =>
  new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export default function BillingPage() {
  const user = useSession();
  const sub = useApi<Subscription>("/subscription");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const isOwner = hasRole(user, ["OWNER"]);

  async function choose(plan: PlanOption) {
    const ending = sub.data?.status === "TRIAL" ? " This ends the free trial and billing starts next month." : "";
    if (!confirm(`Move the school to the ${plan.name} plan, about ${rupees(plan.estimate)} a month?${ending}`)) return;
    setBusy(plan.code);
    setError("");
    try {
      await api("/subscription/plan", { method: "POST", body: { planCode: plan.code } });
      setNotice(`The school is now on the ${plan.name} plan. Reloading...`);
      // The menu and banner come from the session, so start it again.
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  const s = sub.data;
  const unpaid = s?.invoices.filter((i) => i.status === "UNPAID") ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageTitle>Plan and billing</PageTitle>
      <ErrorText>{sub.error}</ErrorText>
      {s && (
        <>
          <Card>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-semibold">{s.plan.name} plan</h2>
              <Badge tone={STATUS[s.status]?.tone}>{STATUS[s.status]?.label ?? s.status}</Badge>
            </div>
            <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-4">
              <div>
                <dt className="opacity-60">Active students</dt>
                <dd className="text-xl font-semibold">{s.usage.students.toLocaleString("en-PK")}</dd>
              </div>
              <div>
                <dt className="opacity-60">Campuses</dt>
                <dd className="text-xl font-semibold">{s.usage.campuses}</dd>
              </div>
              <div>
                <dt className="opacity-60">{s.status === "TRIAL" ? "Would cost per month" : "This month, about"}</dt>
                <dd className="text-xl font-semibold">{rupees(s.estimate)}</dd>
              </div>
              {s.trialEndsAt && s.status === "TRIAL" && (
                <div>
                  <dt className="opacity-60">Trial ends</dt>
                  <dd className="text-xl font-semibold">{day(s.trialEndsAt)}</dd>
                </div>
              )}
              {unpaid.length > 0 && (
                <div>
                  <dt className="opacity-60">Owed to SchoolSyncer</dt>
                  <dd className="text-xl font-semibold text-red-600">{rupees(unpaid.reduce((a, i) => a + i.amount, 0))}</dd>
                </div>
              )}
            </dl>
            {s.reason && <p className="mt-4 text-sm text-amber-700 dark:text-amber-300">{s.reason}</p>}
            {unpaid.length > 0 && (
              <p className="mt-2 text-sm opacity-70">
                Pay by bank transfer or JazzCash and send the receipt to SchoolSyncer support with the bill number.
              </p>
            )}
          </Card>

          <div>
            <h2 className="mb-1 text-lg font-semibold">Plans</h2>
            <p className="mb-3 text-sm opacity-70">
              Charged monthly for each active student, with a minimum. Prices for {s.usage.students} students.
              {!isOwner && " Only the school's owner can change the plan."}
            </p>
            <div className="grid gap-4 md:grid-cols-3">
              {s.plans.map((p) => {
                const current = p.code === s.plan.code;
                return (
                  <Card key={p.code} className={current ? "border-brand ring-1 ring-brand" : ""}>
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold">{p.name}</h3>
                      {current && <Badge tone="blue">Current</Badge>}
                    </div>
                    <p className="mt-1 text-sm opacity-70">{p.description}</p>
                    <p className="mt-3 text-2xl font-semibold">
                      {rupees(p.estimate)}
                      <span className="text-sm font-normal opacity-60"> /month</span>
                    </p>
                    <p className="text-xs opacity-60">
                      Rs {p.pricePerStudent} a student, at least {rupees(p.minimumMonthly)}
                    </p>
                    <ul className="mt-3 space-y-1 text-sm">
                      <li>{p.maxStudents ? `Up to ${p.maxStudents.toLocaleString("en-PK")} students` : "Unlimited students"}</li>
                      <li>{p.maxCampuses ? `${p.maxCampuses} ${p.maxCampuses === 1 ? "campus" : "campuses"}` : "Unlimited campuses"}</li>
                      {p.features.map((f) => (
                        <li key={f} className="opacity-80">✓ {f}</li>
                      ))}
                    </ul>
                    {isOwner && !(current && s.status !== "TRIAL") && (
                      <Button
                        className="mt-4 w-full"
                        variant={current ? "primary" : "ghost"}
                        disabled={!p.fits || busy !== ""}
                        title={p.fits ? undefined : "The school has more students or campuses than this plan allows"}
                        onClick={() => choose(p)}
                      >
                        {busy === p.code ? "Saving..." : current ? `Keep ${p.name} after the trial` : p.fits ? `Switch to ${p.name}` : "Too small for the school"}
                      </Button>
                    )}
                  </Card>
                );
              })}
            </div>
            <div className="mt-3">
              <ErrorText>{error}</ErrorText>
              <Notice>{notice}</Notice>
            </div>
          </div>

          <Card>
            <h2 className="mb-3 text-lg font-semibold">Bills from SchoolSyncer</h2>
            {s.invoices.length === 0 ? (
              <p className="text-sm opacity-70">No bills yet. The first one comes at the start of the month after the trial.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className={tableClass}>
                  <thead className="opacity-60">
                    <tr><th className="py-2">Bill</th><th>Month</th><th>Plan</th><th>Students</th><th>Amount</th><th>Due</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {s.invoices.map((i) => (
                      <tr key={i.id} className={rowClass}>
                        <td className="py-2 font-mono text-xs">{i.number}</td>
                        <td>{monthName(i.period)}</td>
                        <td>{i.planName}</td>
                        <td>{i.students}</td>
                        <td>{rupees(i.amount)}</td>
                        <td>{day(i.dueDate)}</td>
                        <td>
                          {i.status === "PAID" ? (
                            <Badge tone="green">Paid {i.paidAt && day(i.paidAt)}</Badge>
                          ) : i.status === "VOID" ? (
                            <Badge>Cancelled</Badge>
                          ) : (
                            <Badge tone="red">Unpaid</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
