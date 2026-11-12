"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { LoaderCircle, QrCode, Send, Unlink } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, ConfirmDialog, SkeletonRows, TextField, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { formatWhatsAppNumber, LINK_POLL_MS, LINK_STATE_LABEL, pollsLink, type LinkTestResult, type LinkView } from "@/lib/whatsapp-link";

/**
 * Link the school's own WhatsApp number by QR code, the way WhatsApp Web does
 * (no Meta Business account, tokens or approved templates). Shown only when
 * SchoolSyncer switched "WhatsApp by QR link" on for the school.
 */
export function WhatsAppLinkCard({ readOnly, onChanged }: { readOnly: boolean; onChanged: () => void }) {
  const toast = useToast();
  const status = useApi<LinkView>("/school/messaging/link");
  const view = status.data;
  const [actionError, setActionError] = useState("");
  const error = actionError || (view ? "" : status.error);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [phone, setPhone] = useState("");
  const [testing, setTesting] = useState(false);
  const refresh = status.reload;

  // While the QR is up, ask again so the card moves on as soon as it is scanned.
  const waiting = pollsLink(view);
  const state = view?.state;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void refresh(), LINK_POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, refresh]);
  // Tell the page (which shows who sends now) only when the scan just went through.
  const previous = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (state === "CONNECTED" && previous.current === "WAITING_FOR_SCAN") onChanged();
    previous.current = state;
    // onChanged is a new function every render; only a change of state matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  async function act(path: "connect" | "disconnect") {
    setBusy(true);
    try {
      await api<LinkView>(`/school/messaging/link/${path}`, { method: "POST" });
      setActionError("");
      await refresh();
      if (path === "disconnect") {
        setConfirming(false);
        toast.success("WhatsApp unlinked");
        onChanged();
      }
    } catch (e) {
      setActionError((e as Error).message);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  async function test(e: FormEvent) {
    e.preventDefault();
    setTesting(true);
    try {
      const result = await api<LinkTestResult>("/school/messaging/link/test", { method: "POST", body: { phone: phone.trim() } });
      if (result.status === "SENT") toast.success("Test message sent");
      else toast.error("Test message failed", result.error ?? undefined);
    } catch (err) {
      toast.error("Could not send", (err as Error).message);
    } finally {
      setTesting(false);
    }
  }

  if (!view) {
    return error ? <Alert tone="danger">{error}</Alert> : <Card><SkeletonRows rows={3} columns={2} /></Card>;
  }
  if (!view.allowed) return null;

  return (
    <Card>
      <CardHeader
        icon={<QrCode />}
        title="Link your WhatsApp by QR code"
        description="Send from the school's own WhatsApp number by scanning a code, like WhatsApp Web. No Meta Business account or templates needed."
        action={<Badge tone={view.state === "CONNECTED" ? "success" : "neutral"}>{LINK_STATE_LABEL[view.state]}</Badge>}
      />
      <div className="flex flex-col gap-4">
        <Alert tone="warning">
          This links WhatsApp the same way WhatsApp Web does. WhatsApp does not officially allow it, and it can ban a number that messages
          people who did not ask. Use a separate number for the school, not a personal one, and message only parents who gave you their number.
        </Alert>
        {error && <Alert tone="danger">{error}</Alert>}
        {!view.serverReady ? (
          <p className="text-sm text-fg-muted">WhatsApp linking is not set up on this server yet. Ask your SchoolSyncer administrator.</p>
        ) : view.state === "CONNECTED" ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-lg font-semibold tabular-nums">{formatWhatsAppNumber(view.number)}</p>
                {view.profileName && <p className="text-sm text-fg-muted">{view.profileName}</p>}
              </div>
              {!readOnly && (
                <Button type="button" variant="secondary" icon={<Unlink />} onClick={() => setConfirming(true)}>
                  Unlink
                </Button>
              )}
            </div>
            {!readOnly && (
              <form onSubmit={test} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="sm:w-64">
                  <TextField label="Send a test to" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0300 1234567" inputMode="tel" />
                </div>
                <Button type="submit" variant="secondary" icon={<Send />} loading={testing} disabled={phone.trim().length < 5}>
                  Send test
                </Button>
              </form>
            )}
          </>
        ) : view.state === "WAITING_FOR_SCAN" ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="flex h-56 w-56 shrink-0 items-center justify-center self-center rounded-lg border border-border bg-white p-2">
              {view.qr ? (
                // eslint-disable-next-line @next/next/no-img-element -- a data URL from WhatsApp, not an optimisable asset
                <img src={view.qr} alt="WhatsApp link code" className="h-full w-full" />
              ) : (
                <LoaderCircle className="size-6 animate-spin text-fg-muted motion-reduce:animate-none" aria-label="Getting the code" />
              )}
            </div>
            <div className="flex flex-col gap-3 text-sm">
              <ol className="list-decimal space-y-1.5 pl-5">
                <li>Open WhatsApp on the school&apos;s phone.</li>
                <li>
                  Tap <strong>⋮</strong> (or <strong>Settings</strong> on iPhone), then <strong>Linked devices</strong>.
                </li>
                <li>
                  Tap <strong>Link a device</strong> and point the phone at this code.
                </li>
              </ol>
              <p className="text-fg-muted">The code changes every few seconds. This page moves on by itself once it is scanned.</p>
              {!readOnly && (
                <div>
                  <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => act("disconnect")}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          </div>
        ) : (
          !readOnly && (
            <div>
              <Button type="button" icon={<QrCode />} loading={busy} onClick={() => act("connect")}>
                Link WhatsApp
              </Button>
            </div>
          )
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Unlink the school's WhatsApp?"
        description="Messages stop going from this number until it is linked again."
        confirmLabel="Unlink"
        destructive
        loading={busy}
        onConfirm={() => act("disconnect")}
      />
    </Card>
  );
}
