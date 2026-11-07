"use client";

import { useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, ErrorState, Notice, PageHeader, SkeletonRows, Switch, TextareaField, useToast } from "@/components/ui";
import { MessagesNav } from "@/components/messages/messages-nav";
import { api } from "@/lib/api";
import { hasRole, SETUP, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

interface Template {
  key: string;
  label: string;
  placeholders: string[];
  default: string;
  /** The school's own wording; empty means the built-in text. */
  body: string;
  enabled: boolean;
  preview: string;
}

function TemplateCard({ template, onSaved }: { template: Template; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [text, setText] = useState(template.body || template.default);
  const [busy, setBusy] = useState(false);
  const custom = template.body !== "";
  const changed = text.trim() !== (template.body || template.default);

  async function save(body: { body?: string; enabled?: boolean }, done: string) {
    setBusy(true);
    try {
      await api(`/school/message-templates/${template.key}`, { method: "PUT", body });
      toast.success(done);
      await onSaved();
    } catch (e) {
      toast.error("Could not save", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      await api(`/school/message-templates/${template.key}`, { method: "DELETE" });
      setText(template.default);
      toast.success("Back to the built-in wording");
      await onSaved();
    } catch (e) {
      toast.error("Could not reset", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={template.label}
        description={<>Parameters you can use: {template.placeholders.map((p) => <code key={p} className="mr-1 rounded bg-surface-3 px-1 text-xs">{`{${p}}`}</code>)}</>}
        action={
          <div className="flex items-center gap-3">
            {custom && <Badge tone="info">Your wording</Badge>}
            <Switch checked={template.enabled} onCheckedChange={(enabled) => save({ enabled }, enabled ? "Message switched on" : "Message switched off")} label={template.enabled ? "On" : "Off"} disabled={busy} />
          </div>
        }
      />
      <div className="flex flex-col gap-3">
        <TextareaField
          label="Wording"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={600}
          hint={`${text.length}/600. A parameter like {studentName} is replaced by the real value when the message is sent.`}
          disabled={busy || !template.enabled}
        />
        <p className="text-sm text-fg-secondary">
          <span className="font-medium text-fg">Example: </span>
          {changed ? "Save to see the example." : template.preview}
        </p>
        {!template.enabled && <Notice>This message is switched off, so parents will not receive it.</Notice>}
        <div className="flex justify-end gap-2 border-t border-border pt-3">
          {custom && (
            <Button type="button" variant="ghost" icon={<RotateCcw />} disabled={busy} onClick={reset}>
              Use built-in wording
            </Button>
          )}
          <Button type="button" icon={<Save />} loading={busy} disabled={!changed || !text.trim()} onClick={() => save({ body: text.trim() === template.default ? "" : text.trim() }, "Wording saved")}>
            Save
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function TemplatesPage() {
  const user = useSession();
  const templates = useApi<Template[]>("/school/message-templates");
  const canEdit = hasRole(user, SETUP);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Message templates"
        description="Reword the messages parents receive, or switch any of them off."
        breadcrumbs={[{ label: "Communication" }, { label: "Message log" }, { label: "Templates" }]}
      />
      <MessagesNav />
      <Alert tone="info" title="WhatsApp wording">
        Your wording is sent on SMS and shown in the message log. WhatsApp business messages use templates approved by Meta, so a change
        reaches parents on WhatsApp only after the same text is approved in Meta Business Manager under the template&apos;s name.
      </Alert>
      {!canEdit ? (
        <ErrorState compact title="Not allowed" message="Only school admins can change message wording." />
      ) : templates.error ? (
        <ErrorState compact message={templates.error} onRetry={templates.reload} />
      ) : !templates.data ? (
        <SkeletonRows rows={4} columns={1} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {templates.data.map((t) => (
            // Remounted when the saved wording changes, so the editor starts from it.
            <TemplateCard key={`${t.key}:${t.body}`} template={t} onSaved={templates.reload} />
          ))}
        </div>
      )}
    </div>
  );
}
