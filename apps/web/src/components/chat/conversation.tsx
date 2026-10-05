"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowLeft, Check, CheckCheck, Eye, Lock, MessageCircle, SendHorizontal } from "lucide-react";
import { Avatar } from "@/components/kit/avatar";
import { Badge } from "@/components/kit/badge";
import { Button, IconButton } from "@/components/kit/button";
import { Alert, EmptyState, ErrorState, Skeleton } from "@/components/kit/feedback";
import { Textarea } from "@/components/kit/inputs";
import { useToast } from "@/components/kit/toast";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { aboutLine, counterpart, dayLabel, MAX_MESSAGE_LENGTH, messageTime, sameDay, type ChatMessage, type ChatThread, type MessagesPage, type ShownMessage } from "./types";
import { useVisibleInterval } from "./use-visible-interval";

/** How often an open conversation checks for new messages. */
export const CHAT_POLL_MS = 10_000;
const PAGE = 50;

/** Merge server messages into what is shown: newer data wins, order by time, in-flight sends stay last. */
function merge(prev: ShownMessage[], incoming: ChatMessage[]): ShownMessage[] {
  const byId = new Map<string, ShownMessage>();
  for (const m of prev) if (!m.pending) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  const real = [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return [...real, ...prev.filter((m) => m.pending)];
}

interface ConversationProps {
  thread: ChatThread;
  meId: string;
  /** Mobile back button (single-pane layout). */
  onBack: () => void;
  /** Something changed that the thread list should reflect (sent or read a message). */
  onActivity: () => void;
}

function MessagesSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4" aria-hidden>
      {[60, 40, 72, 52, 35].map((w, i) => (
        <div key={i} className={i % 2 ? "self-end" : "self-start"} style={{ width: `${w}%` }}>
          <Skeleton className="h-10 w-full rounded-2xl" />
        </div>
      ))}
    </div>
  );
}

export function Conversation({ thread, meId, onBack, onActivity }: ConversationProps) {
  const toast = useToast();
  const [messages, setMessages] = useState<ShownMessage[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [attempt, setAttempt] = useState(0);

  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  /** scrollHeight before older messages were prepended, to keep the reading position. */
  const restoreFrom = useRef<number | null>(null);
  const latest = useRef<ShownMessage[] | null>(null);
  const marking = useRef(false);

  const base = `/chat/threads/${thread.id}`;
  const name = counterpart(thread);
  const observer = thread.role === "OBSERVER";
  // The thread list does not re-check whether a teacher still teaches the child; the single-thread read does.
  const [canPostLive, setCanPostLive] = useState<boolean | null>(null);
  const canPost = thread.canPost && canPostLive !== false;
  const noLongerTeaches = thread.role === "STAFF" && !canPost && !!thread.guardian && !!thread.staff;

  useEffect(() => {
    if (thread.role !== "STAFF" || !thread.canPost) return;
    let cancelled = false;
    api<ChatThread>(base).then(
      (t) => !cancelled && setCanPostLive(t.canPost),
      () => {
        // Keep the list's answer; the API still refuses a post it should not take.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [base, thread.role, thread.canPost]);

  useEffect(() => {
    latest.current = messages;
  }, [messages]);

  // First page (latest messages). The parent keys this component by thread id.
  useEffect(() => {
    let cancelled = false;
    api<MessagesPage>(`${base}/messages?limit=${PAGE}`).then(
      (page) => {
        if (cancelled) return;
        setMessages(page.items);
        setHasMore(page.hasMore);
        setError("");
      },
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [base, attempt]);

  // Mark the other side's messages read while this conversation is open and visible.
  useEffect(() => {
    if (!messages || observer || marking.current) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    if (!messages.some((m) => !m.mine && !m.pending && !m.readAt)) return;
    marking.current = true;
    api<{ marked: number }>(`${base}/read`, { method: "POST" })
      .then(() => {
        const now = new Date().toISOString();
        setMessages((prev) => prev && prev.map((m) => (!m.mine && !m.readAt ? { ...m, readAt: now } : m)));
        onActivity();
      })
      .catch(() => {
        // Not fatal: the badge stays until the next successful read.
      })
      .finally(() => {
        marking.current = false;
      });
  }, [messages, observer, base, onActivity]);

  const poll = useCallback(async () => {
    const shown = latest.current;
    if (!shown) return;
    const real = shown.filter((m) => !m.pending);
    const last = real.at(-1);
    const lastMine = [...real].reverse().find((m) => m.mine);
    // While my latest message is unseen, re-read the latest page so "Seen" updates; otherwise only fetch newer ones.
    const path = !last || (lastMine && !lastMine.readAt) ? `${base}/messages?limit=${PAGE}` : `${base}/messages?after=${last.id}&limit=100`;
    try {
      const page = await api<MessagesPage>(path);
      if (page.items.length === 0 && last) return;
      setMessages((prev) => (prev ? merge(prev, page.items) : page.items));
    } catch {
      // Keep what is shown; the next tick tries again.
    }
  }, [base]);

  useVisibleInterval(() => void poll(), messages ? CHAT_POLL_MS : null);

  // Scroll: stay pinned to the newest message unless the reader scrolled up; keep position when history loads.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !messages) return;
    if (restoreFrom.current != null) {
      el.scrollTop += el.scrollHeight - restoreFrom.current;
      restoreFrom.current = null;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  function onScroll() {
    const el = scroller.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  async function loadOlder() {
    const first = messages?.find((m) => !m.pending);
    if (!first) return;
    setLoadingOlder(true);
    try {
      const page = await api<MessagesPage>(`${base}/messages?before=${first.id}&limit=${PAGE}`);
      restoreFrom.current = scroller.current?.scrollHeight ?? null;
      setMessages((prev) => (prev ? merge(prev, page.items) : page.items));
      setHasMore(page.hasMore);
    } catch (e) {
      toast.error("Could not load earlier messages", (e as Error).message);
    } finally {
      setLoadingOlder(false);
    }
  }

  function resize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const body = draft.trim();
    if (!body || !canPost) return;
    const tempId = `pending-${Date.now()}`;
    stickToBottom.current = true;
    setMessages((prev) => [
      ...(prev ?? []),
      { id: tempId, body, senderId: meId, senderName: null, mine: true, createdAt: new Date().toISOString(), readAt: null, pending: true },
    ]);
    setDraft("");
    if (composer.current) composer.current.style.height = "auto";
    try {
      const sent = await api<ChatMessage>(`${base}/messages`, { method: "POST", body: { body } });
      setMessages((prev) => merge((prev ?? []).filter((m) => m.id !== tempId), [sent]));
      onActivity();
    } catch (err) {
      setMessages((prev) => (prev ?? []).filter((m) => m.id !== tempId));
      setDraft((d) => d || body);
      if (err instanceof ApiError && err.status === 403) setCanPostLive(false);
      toast.error("Message not sent", (err as Error).message);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  const lastMineId = messages?.filter((m) => m.mine).at(-1)?.id;
  const remaining = MAX_MESSAGE_LENGTH - draft.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-3 sm:px-4">
        <IconButton aria-label="Back to conversations" onClick={onBack} className="lg:hidden">
          <ArrowLeft />
        </IconButton>
        <Avatar name={thread.role === "OBSERVER" ? thread.student.name : name} src={thread.role === "OBSERVER" ? thread.student.photoUrl : null} size="md" />
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate text-base font-semibold text-fg">{name}</h2>
          <p className="truncate text-[13px] text-fg-muted">{aboutLine(thread)}</p>
        </div>
        {!canPost && (
          <Badge tone={observer ? "info" : "neutral"} icon={observer ? <Eye /> : <Lock />}>
            Read only
          </Badge>
        )}
      </header>

      {observer ? (
        <Alert banner tone="info" icon={<Eye />}>
          You are viewing this conversation as a school administrator for safeguarding. It is read-only.
        </Alert>
      ) : (
        !canPost && (
          <Alert banner tone="neutral" icon={<Lock />}>
            {noLongerTeaches
              ? "You no longer teach this student, so this conversation is read-only. You can still read it."
              : "This conversation is closed because the parent or teacher account is no longer active. You can still read it."}
          </Alert>
        )
      )}

      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-surface-2/50 [scrollbar-width:thin]">
        {error && !messages ? (
          <ErrorState compact message={error} onRetry={() => setAttempt((a) => a + 1)} className="m-4" />
        ) : !messages ? (
          <MessagesSkeleton />
        ) : messages.length === 0 ? (
          <EmptyState
            compact
            icon={<MessageCircle />}
            title="No messages yet"
            description={canPost ? `Start the conversation with ${name} about ${thread.student.name}.` : "Nothing has been sent in this conversation."}
            className="m-4"
          />
        ) : (
          <div className="flex flex-col gap-1 px-3 py-4 sm:px-5">
            {hasMore && (
              <div className="mb-3 flex justify-center">
                <Button type="button" variant="secondary" size="sm" loading={loadingOlder} onClick={() => void loadOlder()}>
                  Load earlier messages
                </Button>
              </div>
            )}
            <ol role="log" aria-label={`Messages with ${name}`} aria-live="polite" className="flex flex-col gap-1">
              {messages.map((m, i) => {
                const prev = messages[i - 1];
                const newDay = !prev || !sameDay(prev.createdAt, m.createdAt);
                const grouped = !newDay && prev && prev.senderId === m.senderId;
                const right = observer ? !!thread.staff && m.senderId === thread.staff.id : m.mine;
                const sender = m.mine ? "You" : (m.senderName ?? "Former member");
                return (
                  <Fragment key={m.id}>
                    {newDay && (
                      <li className="my-3 flex items-center gap-3 text-xs font-medium text-fg-muted">
                        <span className="h-px flex-1 bg-border" />
                        {dayLabel(m.createdAt)}
                        <span className="h-px flex-1 bg-border" />
                      </li>
                    )}
                    <li className={cn("flex flex-col", right ? "items-end" : "items-start", !grouped && "mt-2")}>
                      {!grouped && (observer || !m.mine) && <span className="mb-1 px-1 text-xs font-medium text-fg-muted">{sender}</span>}
                      <div
                        className={cn(
                          "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm sm:max-w-[70%]",
                          m.mine
                            ? "rounded-br-md bg-primary text-primary-fg"
                            : right
                              ? "rounded-br-md bg-primary-tint text-fg"
                              : "rounded-bl-md border border-border bg-surface text-fg",
                          m.pending && "opacity-70",
                        )}
                      >
                        <span className="sr-only">{sender}: </span>
                        {m.body}
                      </div>
                      <span className="mt-0.5 flex items-center gap-1 px-1 text-[11px] text-fg-muted tabular-nums">
                        {m.pending ? (
                          "Sending"
                        ) : (
                          <>
                            <time dateTime={m.createdAt}>{messageTime(m.createdAt)}</time>
                            {m.id === lastMineId &&
                              (m.readAt ? (
                                <span className="inline-flex items-center gap-0.5 text-brand">
                                  <CheckCheck className="size-3.5" aria-hidden /> Seen
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-0.5">
                                  <Check className="size-3.5" aria-hidden /> Sent
                                </span>
                              ))}
                          </>
                        )}
                      </span>
                    </li>
                  </Fragment>
                );
              })}
            </ol>
          </div>
        )}
      </div>

      {canPost && (
        <form onSubmit={send} className="shrink-0 border-t border-border bg-surface p-3">
          <div className="flex items-end gap-2">
            <Textarea
              ref={composer}
              rows={1}
              value={draft}
              maxLength={MAX_MESSAGE_LENGTH}
              onChange={(e) => {
                setDraft(e.target.value);
                resize(e.target);
              }}
              onKeyDown={onKeyDown}
              aria-label={`Message to ${name}`}
              aria-describedby={`composer-hint-${thread.id}`}
              placeholder={`Write to ${name}`}
              className="max-h-40 min-h-10 resize-none py-2"
            />
            <IconButton type="submit" variant="primary" aria-label="Send message" disabled={!draft.trim()} className="size-10 shrink-0">
              <SendHorizontal />
            </IconButton>
          </div>
          <p id={`composer-hint-${thread.id}`} className="mt-1.5 flex justify-between gap-2 text-xs text-fg-muted">
            <span className="hidden sm:inline">Press Enter to send, Shift+Enter for a new line.</span>
            <span className="sm:hidden">Enter sends, Shift+Enter adds a line.</span>
            {remaining <= 200 && <span className={cn("tabular-nums", remaining <= 0 && "text-danger-text")}>{remaining} characters left</span>}
          </p>
        </form>
      )}
    </div>
  );
}
