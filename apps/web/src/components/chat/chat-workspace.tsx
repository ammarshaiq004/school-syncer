"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Eye, MessageSquareDashed, MessagesSquare, SquarePen, SearchX } from "lucide-react";
import { Button } from "@/components/kit/button";
import { Card } from "@/components/kit/card";
import { Alert, EmptyState } from "@/components/kit/feedback";
import { PageHeader } from "@/components/kit/layout";
import { SegmentedControl } from "@/components/kit/tabs";
import { cn } from "@/lib/cn";
import { usePersistedState } from "@/lib/persisted";
import { can, hasRole, SETUP, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";
import { CHAT_POLL_MS, Conversation } from "./conversation";
import { NewConversationDialog } from "./new-conversation-dialog";
import { ThreadList } from "./thread-list";
import { type ChatThread } from "./types";
import { refreshChatUnread, setChatUnreadFromThreads } from "./unread";
import { useVisibleInterval } from "./use-visible-interval";

type Scope = "mine" | "all";

/**
 * Two-pane chat: conversations on the left, the open conversation on the right.
 * On phones only one pane shows at a time (the open conversation has a back button).
 * The open conversation lives in `?thread=` so it survives a reload and can be linked to.
 */
export function ChatWorkspace({ kind }: { kind: "staff" | "parent" }) {
  const user = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selectedId = params.get("thread");

  const canWatch = kind === "staff" && hasRole(user, SETUP);
  const [savedScope, setSavedScope] = usePersistedState<Scope>("schoolsyncer.chat.scope", "mine");
  const scope: Scope = canWatch ? savedScope : "mine";
  const [savedChild] = usePersistedState<string>("schoolsyncer.parent.child", "");
  const [composeOpen, setComposeOpen] = useState(false);
  const canStart = kind === "parent" && can(user, "chat", "manage");

  const { data: threads, error, reload } = useApi<ChatThread[]>(`/chat/threads?scope=${scope}`);
  useVisibleInterval(() => void reload(), CHAT_POLL_MS);

  // The "mine" list carries the same unread numbers as the sidebar badge, so keep the badge in step.
  useEffect(() => {
    if (threads && scope === "mine") setChatUnreadFromThreads(threads);
  }, [threads, scope]);

  const onActivity = useCallback(() => {
    void reload();
    if (scope !== "mine") refreshChatUnread();
  }, [reload, scope]);

  const select = useCallback((id: string | null) => router.replace(id ? `${pathname}?thread=${id}` : pathname, { scroll: false }), [router, pathname]);

  const selected = threads?.find((t) => t.id === selectedId) ?? null;

  const newButton = canStart && (
    <Button type="button" icon={<SquarePen />} onClick={() => setComposeOpen(true)}>
      Message a teacher
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={kind === "parent" ? "Teacher chat" : "Messages"}
        description={
          kind === "parent"
            ? "Talk to your children's class and subject teachers. Teachers usually reply during school hours."
            : scope === "all"
              ? "Every parent and teacher conversation in your campuses, for safeguarding."
              : "Conversations with parents about their children."
        }
        actions={
          kind === "parent" ? (
            newButton
          ) : canWatch ? (
            <SegmentedControl<Scope>
              aria-label="Which conversations"
              value={scope}
              onChange={(v) => {
                setSavedScope(v);
                select(null);
              }}
              options={[
                { value: "mine", label: "My conversations", icon: <MessagesSquare /> },
                { value: "all", label: "All conversations", icon: <Eye /> },
              ]}
            />
          ) : undefined
        }
      />

      {scope === "all" && (
        <Alert tone="info" icon={<Eye />} title="Read-only safeguarding view">
          You can read every conversation between parents and teachers in your campuses. You cannot send messages in conversations you are not part of.
        </Alert>
      )}

      <Card padding="none" className="flex h-[calc(100dvh-12.5rem)] min-h-[460px] overflow-hidden lg:h-[calc(100dvh-14rem)]">
        <aside aria-label="Conversation list" className={cn("w-full min-w-0 flex-col lg:flex lg:w-[340px] lg:shrink-0 lg:border-e lg:border-border", selectedId ? "hidden" : "flex")}>
          <ThreadList
            threads={threads}
            error={error}
            onRetry={() => void reload()}
            selectedId={selectedId}
            onSelect={select}
            empty={
              kind === "parent"
                ? { title: "No conversations yet", description: "Send a message to your child's class teacher or a subject teacher.", action: newButton || undefined }
                : scope === "all"
                  ? { title: "No conversations yet", description: "Parent and teacher conversations in your campuses will appear here." }
                  : { title: "No conversations yet", description: "When a parent messages you about their child, it appears here." }
            }
          />
        </aside>
        <section aria-label="Conversation" className={cn("min-w-0 flex-1 flex-col", selectedId ? "flex" : "hidden lg:flex")}>
          {selected ? (
            <Conversation key={selected.id} thread={selected} meId={user.sub} onBack={() => select(null)} onActivity={onActivity} />
          ) : selectedId && threads ? (
            <div className="grid flex-1 place-items-center p-6">
              <EmptyState
                icon={<SearchX />}
                title="Conversation not found"
                description="It may belong to another view or you may no longer have access to it."
                action={
                  <Button type="button" variant="secondary" onClick={() => select(null)}>
                    Back to conversations
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="grid flex-1 place-items-center p-6">
              <EmptyState
                icon={<MessageSquareDashed />}
                title="Select a conversation"
                description={kind === "parent" ? "Pick a teacher on the left, or start a new conversation." : "Pick a conversation on the left to read and reply."}
              />
            </div>
          )}
        </section>
      </Card>

      {kind === "parent" && (
        <NewConversationDialog
          open={composeOpen}
          onOpenChange={setComposeOpen}
          defaultStudentId={savedChild || null}
          onStarted={(t) => {
            void reload();
            select(t.id);
          }}
        />
      )}
    </div>
  );
}
