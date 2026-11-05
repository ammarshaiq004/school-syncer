"use client";

import { useState, type FormEvent } from "react";
import { KeyRound, Pencil, Sparkles, Trash2 } from "lucide-react";
import { useConsoleAdmin, when } from "@/components/platform/session";
import { Alert, Badge, Button, Card, CardHeader, DataTable, Dialog, PageHeader, TextField, useToast, type Column } from "@/components/ui";
import { platformApi } from "@/lib/api";
import { shortTokens } from "@/lib/aon";
import { usePlatformApi } from "@/lib/use-api";

/** Shape of /platform/ai (apps/api/src/platform/platform-ai.controller.ts). */
interface Overview {
  source: "console" | "env" | null;
  consoleKey: { hint: string; updatedAt: string } | null;
  model: string;
  defaultMonthlyTokens: number;
  schools: {
    id: string;
    name: string;
    slug: string;
    aonEnabled: boolean;
    monthlyTokens: number | null;
    limit: number;
    tokensUsed: number;
    requests: number;
  }[];
}

const SOURCE: Record<string, string> = { console: "the key saved here", env: "the server's ANTHROPIC_API_KEY setting" };

/** The AI key behind Aon, and what each school may use of it each month. */
export default function AiPage() {
  const toast = useToast();
  const isOwner = useConsoleAdmin().role === "OWNER";
  const overview = usePlatformApi<Overview>("/ai");
  const [keyOpen, setKeyOpen] = useState(false);
  const [editing, setEditing] = useState<Overview["schools"][number] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const o = overview.data;

  async function run(action: () => Promise<unknown>, done: string, close: () => void) {
    setSaving(true);
    setError("");
    try {
      await action();
      toast.success(done);
      close();
      await overview.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const saveKey = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const key = String(new FormData(event.currentTarget).get("key"));
    return run(() => platformApi("/ai/key", { method: "PUT", body: { key } }), "AI key saved", () => setKeyOpen(false));
  };

  const saveLimit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const raw = String(new FormData(event.currentTarget).get("limit")).trim();
    return run(
      () => platformApi(`/ai/schools/${editing!.id}`, { method: "PATCH", body: { monthlyTokens: raw === "" ? null : Number(raw) } }),
      "Allowance saved",
      () => setEditing(null),
    );
  };

  const columns: Column<Overview["schools"][number]>[] = [
    {
      id: "school",
      header: "School",
      sortValue: (s) => s.name,
      cell: (s) => (
        <>
          <span className="font-medium text-fg">{s.name}</span>
          {!s.aonEnabled && <Badge tone="warning" className="ms-2">Aon off</Badge>}
        </>
      ),
    },
    { id: "used", header: "Used this month", align: "right", sortValue: (s) => s.tokensUsed, cell: (s) => `${shortTokens(s.tokensUsed)} tokens, ${s.requests} requests` },
    {
      id: "limit",
      header: "Allowance",
      align: "right",
      sortValue: (s) => s.limit,
      cell: (s) => (s.monthlyTokens === null ? `${shortTokens(s.limit)} (default)` : s.limit === 0 ? "AI stopped" : shortTokens(s.limit)),
    },
    ...(isOwner
      ? [
          {
            id: "action",
            header: "",
            align: "right" as const,
            cell: (s: Overview["schools"][number]) => (
              <Button size="sm" variant="secondary" icon={<Pencil />} onClick={() => { setError(""); setEditing(s); }}>
                Change
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="AI and Aon" description="The AI key behind Aon, the assistant panel in schools, and how much of it each school may use each month." />

      <Card>
        <CardHeader
          icon={<KeyRound />}
          title="API key"
          description="Aon and the AI assistant use one Anthropic key for every school. A key saved here is stored encrypted, is never shown again, and replaces the server's own setting."
          action={
            isOwner && (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => { setError(""); setKeyOpen(true); }}>
                  {o?.consoleKey ? "Replace key" : "Add key"}
                </Button>
                {o?.consoleKey && (
                  <Button size="sm" variant="secondary" icon={<Trash2 />} onClick={() => void run(() => platformApi("/ai/key", { method: "DELETE" }), "Saved key removed", () => undefined)}>
                    Remove
                  </Button>
                )}
              </div>
            )
          }
        />
        {overview.error ? (
          <Alert tone="danger">{overview.error}</Alert>
        ) : !o ? null : o.source ? (
          <p className="text-sm text-fg-secondary">
            Aon is <strong>on</strong>, using {SOURCE[o.source]}
            {o.source === "console" && o.consoleKey ? ` (ends in ${o.consoleKey.hint}, saved ${when(o.consoleKey.updatedAt)})` : ""}. Model: {o.model}.
          </p>
        ) : (
          <Alert tone="warning">No key is set, so Aon cannot answer questions. Schools still get the at-risk list and template drafts.</Alert>
        )}
      </Card>

      <Card padding="none">
        <div className="px-5 pt-5">
          <CardHeader
            icon={<Sparkles />}
            title="Monthly allowance per school"
            description={o ? `Each school may use ${shortTokens(o.defaultMonthlyTokens)} tokens a month unless you change it here. Questions stop for a school that reaches its allowance until the 1st.` : undefined}
          />
        </div>
        <DataTable
          bare
          label="AI use by school"
          columns={columns}
          data={o?.schools ?? null}
          error={overview.error}
          onRetry={overview.reload}
          getRowId={(s) => s.id}
          empty={{ icon: <Sparkles />, title: "No AI use yet this month", description: "Schools show up here once they ask Aon something or you change their allowance." }}
        />
      </Card>

      <Dialog open={keyOpen} onOpenChange={(v) => !saving && setKeyOpen(v)} title="AI API key" description="Paste an Anthropic API key. It is encrypted when saved and cannot be read back.">
        <form onSubmit={saveKey} className="flex flex-col gap-4">
          <TextField label="API key" name="key" type="password" required autoComplete="off" placeholder="sk-ant-…" />
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" type="button" onClick={() => setKeyOpen(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" loading={saving}>Save key</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(v) => !saving && !v && setEditing(null)} title={editing ? `Allowance for ${editing.name}` : ""}>
        <form onSubmit={saveLimit} className="flex flex-col gap-4" key={editing?.id}>
          <TextField
            label="Tokens per month"
            name="limit"
            type="number"
            min={0}
            defaultValue={editing?.monthlyTokens ?? ""}
            hint={`Leave empty for the default (${o ? shortTokens(o.defaultMonthlyTokens) : "…"}). Enter 0 to stop AI for this school.`}
          />
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" type="button" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
            <Button type="submit" loading={saving}>Save</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
