"use client";

import { Brain, Trash2 } from "lucide-react";
import { useState } from "react";
import { Alert, Badge, Button, Card, CardHeader, ErrorState, SkeletonRows, Switch, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { shortTokens } from "@/lib/aon";
import { day } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import type { AonNote, AssistantStatus } from "./assistant-types";

/** Settings > Aon: the school's switch, this month's AI allowance, and what Aon has been asked to remember. */
export function AonSettings({ readOnly }: { readOnly: boolean }) {
  const toast = useToast();
  const status = useApi<AssistantStatus>("/assistant/status");
  const memory = useApi<AonNote[]>("/assistant/memory");
  const [busy, setBusy] = useState(false);
  const s = status.data;
  const manage = !readOnly && s?.aon.canManage === true;

  async function toggle(enabled: boolean) {
    setBusy(true);
    try {
      await api("/assistant/settings", { method: "PATCH", body: { enabled } });
      await status.reload();
      toast.success(enabled ? "Aon is on" : "Aon is off");
    } catch (e) {
      toast.error("Could not change Aon", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function forget(id: string) {
    try {
      await api(`/assistant/memory/${id}`, { method: "DELETE" });
      await memory.reload();
    } catch (e) {
      toast.error("Could not remove the note", (e as Error).message);
    }
  }

  if (status.error) return <ErrorState message={status.error} onRetry={status.reload} />;
  if (!s) return <Card><SkeletonRows rows={3} columns={2} /></Card>;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Card>
        <CardHeader
          icon={<Brain />}
          title="Aon"
          description="The assistant panel that answers questions about your classes, results, attendance and fees. Press Ctrl+/ anywhere to open it. It can read what each person's role can see, and it cannot change anything."
        />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Switch
            checked={s.aon.enabled}
            onCheckedChange={(v) => void toggle(v)}
            disabled={!manage || busy}
            label={s.aon.enabled ? "Aon is on for your school" : "Aon is off for your school"}
          />
          <Badge tone={s.aon.monthUsed >= s.aon.monthLimit ? "warning" : "neutral"}>
            {shortTokens(s.aon.monthUsed)} of {shortTokens(s.aon.monthLimit)} AI tokens used this month
          </Badge>
        </div>
        {!s.ai && <Alert tone="info" className="mt-4">The AI service is not set up on this server yet, so Aon cannot answer. SchoolSyncer support adds the key.</Alert>}
      </Card>

      <Card>
        <CardHeader
          title="What Aon remembers"
          description="Short notes your school asked Aon to keep in mind, for example “Fees are due on the 10th”. Say “remember …” to Aon to add one. Aon reads these as background, never as orders."
        />
        {memory.error ? (
          <ErrorState message={memory.error} onRetry={memory.reload} />
        ) : !memory.data ? (
          <SkeletonRows rows={2} columns={1} />
        ) : memory.data.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-fg-muted">Nothing saved yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {memory.data.map((n) => (
              <li key={n.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="break-words text-sm text-fg">{n.note}</p>
                  <p className="text-xs text-fg-muted">{day(n.createdAt)}</p>
                </div>
                {manage && (
                  <Button size="sm" variant="ghost" icon={<Trash2 />} aria-label={`Forget: ${n.note}`} onClick={() => void forget(n.id)}>
                    Forget
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
