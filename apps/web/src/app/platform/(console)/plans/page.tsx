"use client";

import { useState } from "react";
import { Button, Card, ErrorText, Notice, PageTitle } from "@/components/ui";
import { platformApi } from "@/lib/api";
import { rupees } from "@/lib/format";
import { usePlatformApi } from "@/lib/use-api";

interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  pricePerStudent: number;
  minimumMonthly: number;
  maxStudents: number | null;
  maxCampuses: number | null;
  features: string[];
  isPublic: boolean;
  schools: number;
}

const inputClass = "rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20";
const numberOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

function PlanEditor({ plan, features, onSaved }: { plan: Plan; features: Record<string, string>; onSaved: () => void }) {
  const [draft, setDraft] = useState(plan);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function save() {
    setError("");
    setNotice("");
    try {
      await platformApi(`/plans/${plan.id}`, {
        method: "PATCH",
        body: {
          name: draft.name,
          description: draft.description,
          pricePerStudent: draft.pricePerStudent,
          minimumMonthly: draft.minimumMonthly,
          maxStudents: draft.maxStudents,
          maxCampuses: draft.maxCampuses,
          features: draft.features,
          isPublic: draft.isPublic,
        },
      });
      setNotice(`Saved. ${plan.schools} ${plan.schools === 1 ? "school uses" : "schools use"} this plan.`);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const toggle = (f: string) =>
    setDraft({ ...draft, features: draft.features.includes(f) ? draft.features.filter((x) => x !== f) : [...draft.features, f] });

  return (
    <Card>
      <div className="flex items-center justify-between">
        <input className={`${inputClass} text-lg font-semibold`} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Name" />
        <span className="text-sm opacity-60">{plan.schools} {plan.schools === 1 ? "school" : "schools"}</span>
      </div>
      <textarea
        className={`${inputClass} mt-2 w-full`}
        rows={2}
        value={draft.description ?? ""}
        onChange={(e) => setDraft({ ...draft, description: e.target.value || null })}
        aria-label="Description"
      />
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span>Rs per student</span>
          <input type="number" min={0} className={inputClass} value={draft.pricePerStudent} onChange={(e) => setDraft({ ...draft, pricePerStudent: Number(e.target.value) })} />
        </label>
        <label className="flex flex-col gap-1">
          <span>Monthly minimum</span>
          <input type="number" min={0} className={inputClass} value={draft.minimumMonthly} onChange={(e) => setDraft({ ...draft, minimumMonthly: Number(e.target.value) })} />
        </label>
        <label className="flex flex-col gap-1">
          <span>Student limit</span>
          <input type="number" min={1} placeholder="Unlimited" className={inputClass} value={draft.maxStudents ?? ""} onChange={(e) => setDraft({ ...draft, maxStudents: numberOrNull(e.target.value) })} />
        </label>
        <label className="flex flex-col gap-1">
          <span>Campus limit</span>
          <input type="number" min={1} placeholder="Unlimited" className={inputClass} value={draft.maxCampuses ?? ""} onChange={(e) => setDraft({ ...draft, maxCampuses: numberOrNull(e.target.value) })} />
        </label>
      </div>
      <p className="mt-2 text-xs opacity-60">
        500 students would pay {rupees(Math.max(draft.minimumMonthly, draft.pricePerStudent * 500))} a month.
      </p>
      <fieldset className="mt-3 text-sm">
        <legend className="mb-1 font-medium">Modules</legend>
        {Object.entries(features).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 py-0.5">
            <input type="checkbox" checked={draft.features.includes(key)} onChange={() => toggle(key)} />
            {label}
          </label>
        ))}
      </fieldset>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={draft.isPublic} onChange={(e) => setDraft({ ...draft, isPublic: e.target.checked })} />
        Schools can choose it themselves
      </label>
      <div className="mt-4 flex flex-col gap-2">
        <ErrorText>{error}</ErrorText>
        <Notice>{notice}</Notice>
        <Button onClick={save}>Save {draft.name}</Button>
      </div>
    </Card>
  );
}

export default function PlansPage() {
  const { data, error, reload } = usePlatformApi<{ features: Record<string, string>; plans: Plan[] }>("/plans");
  return (
    <div className="flex flex-col gap-4">
      <PageTitle>Plans</PageTitle>
      <p className="text-sm opacity-70">
        Student records, attendance, announcements, user management and the parent portal come with every plan. Changes
        apply to every school on the plan straight away; existing bills keep their amounts.
      </p>
      <ErrorText>{error}</ErrorText>
      <div className="grid gap-4 lg:grid-cols-3">
        {data?.plans.map((p) => <PlanEditor key={p.id} plan={p} features={data.features} onSaved={reload} />)}
      </div>
    </div>
  );
}
