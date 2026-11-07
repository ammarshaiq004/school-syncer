"use client";

import { useState, type FormEvent } from "react";
import { Inbox, Send } from "lucide-react";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, PageHeader, SkeletonRows, TextareaField, useToast } from "@/components/ui";
import { MessagesNav } from "@/components/messages/messages-nav";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { hasRole, SETUP, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

interface Guardian {
  name: string;
  students: string[];
}
interface Thread {
  phone: string;
  name: string | null;
  lastBody: string;
  lastAt: string;
  lastDirection: "IN" | "OUT";
  unread: number;
  guardian: Guardian | null;
}
interface Message {
  id: string;
  direction: "IN" | "OUT";
  body: string;
  createdAt: string;
}
interface ThreadDetail {
  phone: string;
  guardian: Guardian | null;
  canReply: boolean;
  messages: Message[];
}

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
/** 923001234567 -> 0300 1234567 */
const local = (phone: string) => (phone.startsWith("92") ? `0${phone.slice(2, 5)} ${phone.slice(5)}` : `+${phone}`);

function Conversation({ phone, onChanged }: { phone: string; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const detail = useApi<ThreadDetail>(`/whatsapp/threads/${phone}`);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  // Opening a thread marks it read on the server; refresh the list's unread counts once it has loaded.
  const [marked, setMarked] = useState<string | null>(null);
  if (detail.data && marked !== phone) {
    setMarked(phone);
    void onChanged();
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api(`/whatsapp/threads/${phone}/reply`, { method: "POST", body: { text } });
      setText("");
      await Promise.all([detail.reload(), onChanged()]);
    } catch (e) {
      toast.error("Could not send", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (detail.error) return <ErrorState compact message={detail.error} onRetry={detail.reload} />;
  if (!detail.data) return <SkeletonRows rows={4} columns={1} />;
  const d = detail.data;
  return (
    <Card className="flex min-h-96 flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold text-fg">{d.guardian?.name ?? local(phone)}</h2>
        <p className="text-sm text-fg-muted">
          {local(phone)}
          {d.guardian && d.guardian.students.length > 0 && <> · parent of {d.guardian.students.join(", ")}</>}
        </p>
      </div>
      <ol className="flex max-h-[28rem] flex-1 flex-col gap-2 overflow-y-auto" aria-label="Messages">
        {d.messages.map((m) => (
          <li key={m.id} className={cn("max-w-[85%] rounded-xl px-3 py-2 text-sm", m.direction === "IN" ? "self-start bg-surface-3 text-fg" : "self-end bg-primary text-white")}>
            <p className="whitespace-pre-wrap break-words">{m.body}</p>
            <time dateTime={m.createdAt} className={cn("mt-1 block text-[11px]", m.direction === "IN" ? "text-fg-muted" : "text-white/80")}>
              {when(m.createdAt)}
            </time>
          </li>
        ))}
      </ol>
      {d.canReply ? (
        <form onSubmit={send} className="flex flex-col gap-2 border-t border-border pt-3">
          <TextareaField label="Reply" rows={2} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} required />
          <div className="flex justify-end">
            <Button type="submit" icon={<Send />} loading={busy} disabled={!text.trim()}>
              Send reply
            </Button>
          </div>
        </form>
      ) : (
        <Alert tone="warning">
          WhatsApp allows a free reply only within 24 hours of the parent&apos;s last message. To reach this parent now, send a fee reminder or an
          announcement.
        </Alert>
      )}
    </Card>
  );
}

export default function InboxPage() {
  const user = useSession();
  const threads = useApi<Thread[]>("/whatsapp/threads");
  const [open, setOpen] = useState<string | null>(null);
  const unread = (threads.data ?? []).reduce((n, t) => n + t.unread, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="WhatsApp inbox"
        description="What parents write back to the school's WhatsApp number, with your replies."
        breadcrumbs={[{ label: "Communication" }, { label: "Message log" }, { label: "WhatsApp inbox" }]}
        meta={unread > 0 ? <Badge tone="info">{unread} unread</Badge> : undefined}
      />
      <MessagesNav />
      {!hasRole(user, SETUP) ? (
        <ErrorState compact title="Not allowed" message="Only school admins can open the WhatsApp inbox." />
      ) : threads.error ? (
        <ErrorState compact message={threads.error} onRetry={threads.reload} />
      ) : !threads.data ? (
        <SkeletonRows rows={4} columns={1} />
      ) : threads.data.length === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title="No replies yet"
          description="When a parent answers one of your WhatsApp messages it appears here. Replies reach the inbox once the WhatsApp webhook is connected (see the go-live runbook)."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface" aria-label="Conversations">
            {threads.data.map((t) => (
              <li key={t.phone}>
                <button
                  type="button"
                  onClick={() => setOpen(t.phone)}
                  aria-current={open === t.phone ? "true" : undefined}
                  className={cn("flex w-full flex-col gap-0.5 px-4 py-3 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring", open === t.phone && "bg-surface-2")}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className={cn("truncate text-sm text-fg", t.unread ? "font-semibold" : "font-medium")}>{t.guardian?.name ?? t.name ?? local(t.phone)}</span>
                    {t.unread > 0 && <Badge tone="info">{t.unread}</Badge>}
                  </span>
                  <span className="truncate text-xs text-fg-muted">
                    {t.lastDirection === "OUT" ? "You: " : ""}
                    {t.lastBody}
                  </span>
                  <span className="text-[11px] text-fg-muted">{when(t.lastAt)}</span>
                </button>
              </li>
            ))}
          </ul>
          {open ? <Conversation key={open} phone={open} onChanged={threads.reload} /> : <EmptyState compact title="Choose a conversation" />}
        </div>
      )}
    </div>
  );
}
