"use client";

import { useMemo, useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import { Alert, Badge, Button, Card, CardFooter, CardHeader, ErrorState, Skeleton, Switch, useToast } from "@/components/ui";
import { platformApi } from "@/lib/api";
import { usePlatformApi } from "@/lib/use-api";

export interface FeatureState {
  planFeatures: string[];
  featuresAdded: string[];
  featuresRemoved: string[];
  features: string[];
}

/**
 * Per-school module overrides on top of the plan: switch a module on that the
 * plan lacks, or off when the plan includes it. Owners only can save.
 */
export function SchoolFeatures({
  schoolId,
  planName,
  state,
  canEdit,
  onSaved,
}: {
  schoolId: string;
  planName: string;
  state: FeatureState;
  canEdit: boolean;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const catalog = usePlatformApi<{ features: Record<string, string> }>("/plans");
  const [on, setOn] = useState(() => new Set(state.features));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const inPlan = useMemo(() => new Set(state.planFeatures), [state.planFeatures]);

  const keys = catalog.data ? Object.keys(catalog.data.features) : [];
  const added = keys.filter((k) => on.has(k) && !inPlan.has(k));
  const removed = keys.filter((k) => !on.has(k) && inPlan.has(k));
  const saved = useMemo(() => new Set(state.features), [state.features]);
  const dirty = keys.some((k) => on.has(k) !== saved.has(k));

  function flip(key: string, value: boolean) {
    setOn((prev) => {
      const next = new Set(prev);
      if (value) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      await platformApi(`/schools/${schoolId}/features`, { method: "PUT", body: { added, removed } });
      toast.success("Modules saved", "The school sees the change within a few seconds.");
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="max-w-3xl">
      <CardHeader title="Plan and modules" description={`Modules come from the ${planName} plan. Switch one on or off to override it for this school only.`} />
      {!canEdit && (
        <Alert tone="info" className="mb-4">
          Only a SchoolSyncer owner can change module overrides.
        </Alert>
      )}
      {catalog.error ? (
        <ErrorState message={catalog.error} onRetry={catalog.reload} compact />
      ) : !catalog.data ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {keys.map((key) => {
            const enabled = on.has(key);
            const overridden = enabled !== inPlan.has(key);
            return (
              <li key={key} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-3 first:pt-0">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-fg">{catalog.data!.features[key]}</div>
                  <div className="text-xs text-fg-muted">{inPlan.has(key) ? `Included in ${planName}` : `Not in ${planName}`}</div>
                </div>
                {overridden && <Badge tone={enabled ? "primary" : "warning"}>{enabled ? "Added for this school" : "Removed for this school"}</Badge>}
                <Switch
                  checked={enabled}
                  onCheckedChange={(v) => flip(key, v)}
                  disabled={!canEdit}
                  aria-label={`${catalog.data!.features[key]} for this school`}
                />
              </li>
            );
          })}
        </ul>
      )}
      {error && (
        <Alert tone="danger" className="mt-4">
          {error}
        </Alert>
      )}
      {canEdit && catalog.data && (
        <CardFooter className="justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            icon={<RotateCcw />}
            disabled={added.length + removed.length === 0}
            onClick={() => setOn(new Set(state.planFeatures))}
          >
            Match the plan
          </Button>
          <Button type="button" icon={<Save />} loading={saving} disabled={!dirty} onClick={save}>
            Save modules
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
