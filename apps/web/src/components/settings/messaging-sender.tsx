"use client";

import { useState, type FormEvent } from "react";
import { MessageCircle } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, ErrorState, SkeletonRows, Switch, TextField, useToast, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";

/** Shape of GET /school/messaging (apps/api/src/notifications/messaging-settings.controller.ts). */
export type SenderSource = "school" | "platform" | "log";
interface Messaging {
  canSaveSecrets: boolean;
  active: { source: SenderSource; channel: "WHATSAPP" | "SMS" | null };
  platform: { whatsapp: boolean; sms: boolean };
  ownSender: { enabled: boolean; phoneNumberId: string; tokenSet: boolean; updatedAt: string } | null;
}

export function deliveryStatus(active: Messaging["active"]): { label: string; tone: Tone } {
  if (active.source === "school") return { label: "Your WhatsApp number", tone: "success" };
  if (active.source === "platform") return { label: active.channel === "SMS" ? "SchoolSyncer SMS" : "SchoolSyncer's WhatsApp", tone: "info" };
  return { label: "Not delivering", tone: "danger" };
}

/**
 * The school's own WhatsApp Cloud API number. Without one, messages go from
 * SchoolSyncer's number or SMS gateway if the server has one, otherwise they
 * are only logged. The access token is never shown again.
 */
export function MessagingSender({ readOnly }: { readOnly: boolean }) {
  const messaging = useApi<Messaging>("/school/messaging");
  const [saved, setSaved] = useState<Messaging | null>(null);
  const data = saved ?? messaging.data;

  if (messaging.error && !data) return <ErrorState message={messaging.error} onRetry={messaging.reload} />;
  if (!data)
    return (
      <Card>
        <SkeletonRows rows={4} columns={2} />
      </Card>
    );
  return <SenderForm key={JSON.stringify(data.ownSender)} data={data} readOnly={readOnly} onSaved={setSaved} />;
}

function SenderForm({ data, readOnly, onSaved }: { data: Messaging; readOnly: boolean; onSaved: (m: Messaging) => void }) {
  const toast = useToast();
  const [enabled, setEnabled] = useState(data.ownSender?.enabled ?? true);
  const [phoneNumberId, setPhoneNumberId] = useState(data.ownSender?.phoneNumberId ?? "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const status = deliveryStatus(data.active);
  const locked = readOnly || !data.canSaveSecrets;

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api<Messaging>("/school/messaging", {
        method: "PUT",
        body: { enabled, phoneNumberId: phoneNumberId.trim(), ...(token.trim() ? { token: token.trim() } : {}) },
      });
      setError("");
      onSaved(res);
      toast.success("Messaging saved", res.active.source === "school" ? "Messages now go from your WhatsApp number." : undefined);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      onSaved(await api<Messaging>("/school/messaging", { method: "DELETE" }));
      toast.success("Your WhatsApp number was removed");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {data.active.source === "log" && (
        <Alert tone="warning" title="Messages are not being delivered">
          No WhatsApp number or SMS gateway is set up, so attendance alerts, fee messages and password reset codes are only written to
          the message log. Add your WhatsApp Business number below, or ask SchoolSyncer to switch on their sender.
        </Alert>
      )}
      <Card>
        <CardHeader
          icon={<MessageCircle />}
          title="Your WhatsApp number"
          description="Send from the school's own WhatsApp Business number (WhatsApp Cloud API). Parents then see your school's name."
          action={<Badge tone={status.tone}>{status.label}</Badge>}
        />
        <form onSubmit={save} className="flex flex-col gap-4">
          <Switch checked={enabled} onCheckedChange={setEnabled} disabled={locked} label="Send from our own number" />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Phone number ID"
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
              hint="Meta Business Manager > WhatsApp > API setup"
              inputMode="numeric"
              autoComplete="off"
              disabled={locked}
            />
            <TextField
              label="Permanent access token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={data.ownSender?.tokenSet ? "Saved; leave empty to keep" : undefined}
              hint="A system user token with whatsapp_business_messaging"
              autoComplete="new-password"
              disabled={locked}
            />
          </div>
          <p className="text-[13px] text-fg-muted">
            Each message type needs an approved template in Meta Business Manager with the same name (attendance_absent, fee_voucher,
            fee_reminder, fee_paid, parent_invite, exam_result, homework_assigned, school_announcement, and password_reset as an
            Authentication template with a copy-code button).
          </p>
          {error && <Alert tone="danger">{error}</Alert>}
          {!readOnly && (
            <div className="flex flex-wrap justify-end gap-2">
              {data.ownSender && (
                <Button type="button" variant="ghost" onClick={remove} disabled={busy}>
                  Remove my number
                </Button>
              )}
              <Button type="submit" loading={busy} disabled={!data.canSaveSecrets}>
                Save
              </Button>
            </div>
          )}
        </form>
      </Card>
      {!data.canSaveSecrets && !readOnly && (
        <Alert tone="info">Saving a WhatsApp token needs a PAYMENTS_SECRET_KEY on the server. Ask your SchoolSyncer administrator.</Alert>
      )}
    </div>
  );
}
