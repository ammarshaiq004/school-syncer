"use client";

import { useState, type FormEvent } from "react";
import { Megaphone, Send } from "lucide-react";
import { Alert, Button, Card, CardHeader, Checkbox, DataTable, Dialog, PageHeader, SelectField, StatusPill, TextField, TextareaField, useToast, type Column } from "@/components/ui";
import { useConsoleAdmin } from "@/components/platform/session";
import { platformApi } from "@/lib/api";
import { day } from "@/lib/format";
import { usePlatformApi } from "@/lib/use-api";

type Target = "ALL" | "CHOSEN" | "OVERDUE" | "TRIALS_ENDING";
type Severity = "INFO" | "WARNING" | "URGENT";

interface Message {
  id: string;
  title: string;
  body: string;
  severity: Severity;
  target: Target;
  audience: "OWNERS" | "STAFF";
  schools: number;
  sentBy: string;
  createdAt: string;
}

const TARGETS: { value: Target; label: string }[] = [
  { value: "ALL", label: "Every school" },
  { value: "OVERDUE", label: "Overdue schools" },
  { value: "TRIALS_ENDING", label: "Trials ending or over" },
  { value: "CHOSEN", label: "Chosen schools" },
];
const SEVERITIES: { value: Severity; label: string }[] = [
  { value: "INFO", label: "Information" },
  { value: "WARNING", label: "Warning (shows as a banner)" },
  { value: "URGENT", label: "Urgent (shows as a banner)" },
];
const SEVERITY_TONE = { INFO: "info", WARNING: "warning", URGENT: "danger" } as const;
const targetLabel = (t: Target) => TARGETS.find((x) => x.value === t)?.label ?? t;

const columns: Column<Message>[] = [
  {
    id: "title",
    header: "Message",
    sortValue: (m) => m.title,
    cell: (m) => (
      <>
        <span className="font-medium text-fg">{m.title}</span>
        <span className="block max-w-md truncate text-xs text-fg-secondary">{m.body}</span>
      </>
    ),
  },
  { id: "severity", header: "Importance", cell: (m) => <StatusPill status={m.severity} tone={SEVERITY_TONE[m.severity]} label={SEVERITY_TONE[m.severity] === "info" ? "Information" : m.severity === "WARNING" ? "Warning" : "Urgent"} /> },
  {
    id: "to",
    header: "Sent to",
    cell: (m) => (
      <>
        {targetLabel(m.target)}
        <span className="block text-xs text-fg-muted">
          {m.schools} {m.schools === 1 ? "school" : "schools"}, {m.audience === "OWNERS" ? "owners" : "all staff"}
        </span>
      </>
    ),
  },
  { id: "by", header: "Sent by", sortValue: (m) => m.sentBy, cell: (m) => m.sentBy, hideBelow: "md" },
  { id: "at", header: "Date", sortValue: (m) => m.createdAt, cell: (m) => day(m.createdAt), hideBelow: "sm" },
];

/** Messages from SchoolSyncer to its schools: shown in the app and sent by SMS and email. */
export default function MessagesPage() {
  const toast = useToast();
  const admin = useConsoleAdmin();
  const sent = usePlatformApi<Message[]>("/messages");
  const schools = usePlatformApi<{ id: string; name: string }[]>("/schools");
  const [target, setTarget] = useState<Target>("OVERDUE");
  const [chosen, setChosen] = useState<string[]>([]);
  const [audience, setAudience] = useState<"OWNERS" | "STAFF">("OWNERS");
  const [severity, setSeverity] = useState<Severity>("INFO");
  const [confirming, setConfirming] = useState<FormData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // How many would get it; asked again whenever the audience changes.
  const ready = target !== "CHOSEN" || chosen.length > 0;
  const preview = usePlatformApi<{ schools: number; people: number }>(ready ? `/messages/preview?${new URLSearchParams({ target, audience, schoolIds: chosen.join(",") })}` : null);
  const reach = ready ? preview.data : null;

  const everyoneBlocked = target === "ALL" && admin.role !== "OWNER";

  async function send() {
    if (!confirming) return;
    setBusy(true);
    setError("");
    try {
      await platformApi("/messages", {
        method: "POST",
        body: { target, audience, severity, schoolIds: chosen, title: String(confirming.get("title")), body: String(confirming.get("body")) },
      });
      toast.success("Message sent", "It shows in the schools' apps, and goes out by SMS and email.");
      setConfirming(null);
      document.querySelector<HTMLFormElement>("#compose")?.reset();
      await sent.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setConfirming(new FormData(event.currentTarget));
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Messages" description="Write to schools. A message shows in the app and is sent by SMS and email." />
      <Card>
        <CardHeader title="New message" icon={<Megaphone />} />
        <form id="compose" onSubmit={review} className="flex max-w-2xl flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField label="Send to" options={TARGETS} value={target} onChange={(e) => setTarget(e.target.value as Target)} />
            <SelectField label="Who at the school" options={[{ value: "OWNERS", label: "Owners" }, { value: "STAFF", label: "All staff" }]} value={audience} onChange={(e) => setAudience(e.target.value as "OWNERS" | "STAFF")} />
            <SelectField label="Importance" options={SEVERITIES} value={severity} onChange={(e) => setSeverity(e.target.value as Severity)} />
          </div>
          {target === "CHOSEN" && (
            <fieldset className="max-h-48 overflow-y-auto rounded-lg border border-border p-3">
              <legend className="px-1 text-sm font-medium text-fg">Schools</legend>
              <div className="flex flex-col gap-2">
                {schools.data?.map((s) => (
                  <Checkbox key={s.id} label={s.name} checked={chosen.includes(s.id)} onCheckedChange={(c) => setChosen((ids) => (c ? [...ids, s.id] : ids.filter((i) => i !== s.id)))} />
                ))}
              </div>
            </fieldset>
          )}
          <TextField label="Title" name="title" required minLength={3} maxLength={100} />
          <TextareaField label="Message" name="body" required minLength={5} maxLength={1000} rows={5} />
          <p className="text-sm text-fg-secondary" aria-live="polite">
            {everyoneBlocked
              ? "Only a SchoolSyncer owner can message every school."
              : reach
                ? `Reaches ${reach.schools} ${reach.schools === 1 ? "school" : "schools"} and ${reach.people} ${reach.people === 1 ? "person" : "people"}.`
                : target === "CHOSEN" && !chosen.length
                  ? "Choose at least one school."
                  : "Counting…"}
          </p>
          <div>
            <Button type="submit" icon={<Send />} disabled={!reach?.schools || everyoneBlocked}>
              Review and send
            </Button>
          </div>
        </form>
      </Card>

      <DataTable
        label="Sent messages"
        columns={columns}
        data={sent.data}
        error={sent.error}
        onRetry={sent.reload}
        getRowId={(m) => m.id}
        empty={{ icon: <Megaphone />, title: "No messages sent yet" }}
      />

      <Dialog
        open={!!confirming}
        onOpenChange={(o) => !o && !busy && setConfirming(null)}
        title="Send this message?"
        description={reach ? `It goes to ${reach.people} ${reach.people === 1 ? "person" : "people"} at ${reach.schools} ${reach.schools === 1 ? "school" : "schools"} and cannot be taken back.` : ""}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(null)} disabled={busy}>
              Cancel
            </Button>
            <Button icon={<Send />} loading={busy} onClick={() => void send()}>
              Send message
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="font-medium text-fg">{String(confirming?.get("title") ?? "")}</p>
          <p className="whitespace-pre-wrap text-sm text-fg-secondary">{String(confirming?.get("body") ?? "")}</p>
          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      </Dialog>
    </div>
  );
}
