"use client";

import { useState } from "react";
import { Save, Tags } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardFooter,
  Checkbox,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Switch,
  TextareaField,
  TextField,
  useToast,
} from "@/components/ui";
import { platformApi } from "@/lib/api";
import { rupees } from "@/lib/format";
import { usePlatformApi } from "@/lib/use-api";
import { isOwner, useConsoleAdmin } from "@/components/platform/session";

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

const numberOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

function PlanEditor({ plan, features, onSaved, canEdit }: { plan: Plan; features: Record<string, string>; onSaved: () => void; canEdit: boolean }) {
  const toast = useToast();
  const [draft, setDraft] = useState(plan);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setError("");
    setSaving(true);
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
      toast.success(`${draft.name} saved`, `${plan.schools} ${plan.schools === 1 ? "school uses" : "schools use"} this plan.`);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const toggle = (f: string) => setDraft({ ...draft, features: draft.features.includes(f) ? draft.features.filter((x) => x !== f) : [...draft.features, f] });

  return (
    <Card className="flex flex-col">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-xs text-fg-muted">{plan.code}</span>
        <Badge tone={plan.schools ? "primary" : "neutral"}>
          {plan.schools} {plan.schools === 1 ? "school" : "schools"}
        </Badge>
      </div>
      {/* Read-only for support: a disabled fieldset disables every field inside. */}
      <fieldset disabled={!canEdit} className="mt-3 flex min-w-0 flex-col gap-4">
        <TextField label="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="font-semibold" />
        <TextareaField
          label="Description"
          rows={2}
          value={draft.description ?? ""}
          onChange={(e) => setDraft({ ...draft, description: e.target.value || null })}
        />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Rs per student"
            type="number"
            min={0}
            value={draft.pricePerStudent}
            onChange={(e) => setDraft({ ...draft, pricePerStudent: Number(e.target.value) })}
          />
          <TextField
            label="Monthly minimum"
            type="number"
            min={0}
            value={draft.minimumMonthly}
            onChange={(e) => setDraft({ ...draft, minimumMonthly: Number(e.target.value) })}
          />
          <TextField
            label="Student limit"
            type="number"
            min={1}
            placeholder="Unlimited"
            value={draft.maxStudents ?? ""}
            onChange={(e) => setDraft({ ...draft, maxStudents: numberOrNull(e.target.value) })}
          />
          <TextField
            label="Campus limit"
            type="number"
            min={1}
            placeholder="Unlimited"
            value={draft.maxCampuses ?? ""}
            onChange={(e) => setDraft({ ...draft, maxCampuses: numberOrNull(e.target.value) })}
          />
        </div>
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-fg-secondary">
          500 students would pay <span className="font-medium tabular-nums text-fg">{rupees(Math.max(draft.minimumMonthly, draft.pricePerStudent * 500))}</span>{" "}
          a month.
        </p>
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-fg-secondary">Modules</legend>
          <div className="flex flex-col gap-2">
            {Object.entries(features).map(([key, label]) => (
              <Checkbox key={key} label={label} checked={draft.features.includes(key)} onCheckedChange={() => toggle(key)} disabled={!canEdit} />
            ))}
          </div>
        </fieldset>
        <Switch label="Schools can choose it themselves" checked={draft.isPublic} onCheckedChange={(v) => setDraft({ ...draft, isPublic: v })} disabled={!canEdit} />
        {error && <Alert tone="danger">{error}</Alert>}
      </fieldset>
      {canEdit && (
        <div className="mt-auto">
          <CardFooter className="justify-end">
            <Button type="button" icon={<Save />} loading={saving} onClick={save}>
              Save {draft.name}
            </Button>
          </CardFooter>
        </div>
      )}
    </Card>
  );
}

export default function PlansPage() {
  const { data, error, reload } = usePlatformApi<{ features: Record<string, string>; plans: Plan[] }>("/plans");
  const canEdit = isOwner(useConsoleAdmin());
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Plans"
        description="Student records, attendance, announcements, user management and the parent portal come with every plan. Changes apply to every school on the plan straight away; existing bills keep their amounts."
      />
      {!canEdit && <Alert tone="info">Only a SchoolSyncer owner can change plans. You can look at them here.</Alert>}
      {error && !data ? (
        <Card padding="none">
          <ErrorState message={error} onRetry={reload} />
        </Card>
      ) : !data ? (
        <div className="grid gap-6 lg:grid-cols-3" role="status" aria-label="Loading plans">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[560px] w-full rounded-xl" />
          ))}
        </div>
      ) : data.plans.length === 0 ? (
        <Card padding="none">
          <EmptyState icon={<Tags />} title="No plans" description="Plans are created by the database seed." />
        </Card>
      ) : (
        <div className="grid items-stretch gap-6 lg:grid-cols-3">
          {data.plans.map((p) => (
            <PlanEditor key={p.id} plan={p} features={data.features} onSaved={reload} canEdit={canEdit} />
          ))}
        </div>
      )}
    </div>
  );
}
