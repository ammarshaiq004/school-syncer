"use client";

import { SquarePen, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, IconButton } from "@/components/ui";
import { api, type SessionUser } from "@/lib/api";
import { isAonShortcut, shortTokens, type AonPose } from "@/lib/aon";
import { cn } from "@/lib/cn";
import { can, FEES, hasRole, TEACHING } from "@/lib/session";
import { AonFloat } from "./aon-float";
import { AonMark } from "./aon-mascot";
import { AskPanel } from "./ask-panel";
import type { AonTurn, AssistantStatus } from "./assistant-types";

/** Who gets Aon: teaching and fee staff on a plan with the AI assistant, whose role may open it. */
const canUseAon = (user: SessionUser) =>
  user.plan?.features.includes("ai_assistant") === true && hasRole(user, [...TEACHING, "ACCOUNTANT"]) && can(user, "assistant");

/**
 * Aon's status and chat for the signed-in user, or a null status when they do not get Aon (wrong plan or role, or the
 * school switched it off). The conversation lives here, above the page, so it survives closing the panel and moving
 * between screens.
 */
export function useAon(user: SessionUser | null) {
  const allowed = user !== null && canUseAon(user);
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<AonTurn[]>([]);
  const [pose, setPose] = useState<AonPose>("idle");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (allowed) api<AssistantStatus>("/assistant/status").then(setStatus, () => setStatus(null));
  }, [allowed]);
  useEffect(reload, [reload]);

  // Ctrl+/ opens and closes Aon, from anywhere in the app.
  useEffect(() => {
    if (!allowed || !status?.aon.enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isAonShortcut(e)) return;
      e.preventDefault();
      setOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [allowed, status?.aon.enabled]);

  /** Opens Aon and sends it a question (for "Ask Aon" buttons on other screens). */
  const askAbout = useCallback((question: string) => {
    setPendingQuestion(question);
    setOpen(true);
  }, []);
  const takePending = useCallback(() => setPendingQuestion(null), []);

  return { status: status?.aon.enabled ? status : null, open, setOpen, reload, turns, setTurns, pose, setPose, pendingQuestion, askAbout, takePending };
}


/**
 * Aon, docked, and Hudhud, the little bird that opens it from any page. On a desktop the chat is a rounded card at the
 * right edge and the page beside it simply gets narrower (the page keeps working while the chat stays open). On a
 * phone it slides up over the screen. Render it as the last child of the app's row layout.
 */
export function AonLayer({ user, aon }: { user: SessionUser; aon: ReturnType<typeof useAon> }) {
  const { status, open, setOpen, reload, turns, setTurns, pose, setPose, pendingQuestion, takePending } = aon;
  const side = useRef<HTMLElement>(null);

  // A switched-off school must not keep an open (invisible) dock holding a column.
  useEffect(() => {
    if (!status && open) setOpen(false);
  }, [status, open, setOpen]);

  useEffect(() => {
    if (!open) return;
    // Wait for the slide so focus does not scroll the half-open card.
    const t = window.setTimeout(() => side.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true }), 250);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!status) return null;
  const canFees = hasRole(user, FEES) && can(user, "fees");
  const left = Math.max(status.aon.monthLimit - status.aon.monthUsed, 0);

  return (
    <>
      <AonFloat open={open} onToggle={() => setOpen(!open)} />
      <aside
        ref={side}
        aria-label="Aon, your school assistant"
        aria-hidden={!open}
        inert={!open}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        className={cn(
          // Phone: a full-screen layer that slides up. Desktop: a sticky column whose width opens from 0.
          "z-40 bg-bg transition-[width,transform,opacity,visibility] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none print:hidden",
          "max-md:fixed max-md:inset-0 md:sticky md:top-0 md:h-dvh md:shrink-0 md:overflow-hidden",
          open ? "visible opacity-100 max-md:translate-y-0 md:w-[26rem]" : "invisible opacity-0 max-md:translate-y-6 md:w-0",
        )}
      >
        <div className="flex h-full w-full flex-col p-0 md:w-[26rem] md:p-2 md:ps-0">
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface md:rounded-3xl md:border md:border-border md:shadow-overlay">
            <header className="flex items-center gap-3 px-4 pb-3 pt-4 max-md:pt-[max(1rem,env(safe-area-inset-top))]">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary-tint p-1">
                <AonMark pose={pose} className="size-full" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold leading-tight">Aon</h2>
                <p className="truncate text-xs text-fg-muted">Your school&rsquo;s assistant</p>
              </div>
              <Badge tone={left === 0 ? "warning" : "neutral"}>{shortTokens(left)} left</Badge>
              {turns.length > 0 && (
                <IconButton aria-label="New chat" title="New chat" onClick={() => setTurns(() => [])}>
                  <SquarePen />
                </IconButton>
              )}
              <IconButton aria-label="Close Aon" title="Close (Esc)" onClick={() => setOpen(false)}>
                <X />
              </IconButton>
            </header>
            <div className="min-h-0 flex-1">
              <AskPanel
                status={status}
                onUsed={reload}
                canFees={canFees}
                compact
                turns={turns}
                onTurns={setTurns}
                active={open}
                onPose={setPose}
                pendingQuestion={pendingQuestion}
                onPendingTaken={takePending}
              />
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}

