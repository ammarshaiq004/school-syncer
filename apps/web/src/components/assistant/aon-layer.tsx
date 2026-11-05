"use client";

import { useCallback, useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Badge, Drawer } from "@/components/ui";
import { api, type SessionUser } from "@/lib/api";
import { isAonShortcut, shortTokens } from "@/lib/aon";
import { can, FEES, hasRole, TEACHING } from "@/lib/session";
import { AonMascot } from "./aon-mascot";
import { AskPanel } from "./ask-panel";
import type { AssistantStatus } from "./assistant-types";

/** Who gets Aon: teaching and fee staff on a plan with the AI assistant, whose role may open it. */
const canUseAon = (user: SessionUser) =>
  user.plan?.features.includes("ai_assistant") === true && hasRole(user, [...TEACHING, "ACCOUNTANT"]) && can(user, "assistant");

/** Aon's status for the signed-in user, or null when they do not get Aon (wrong plan or role, or the school switched it off). */
export function useAon(user: SessionUser | null) {
  const allowed = user !== null && canUseAon(user);
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [open, setOpen] = useState(false);

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

  return { status: status?.aon.enabled ? status : null, open, setOpen, reload };
}

/** The Aon side panel (Ctrl+/) and Hudhud, the little bird that opens it from any page. */
export function AonLayer({ user, aon }: { user: SessionUser; aon: ReturnType<typeof useAon> }) {
  const { status, open, setOpen, reload } = aon;
  if (!status) return null;
  const canFees = hasRole(user, FEES) && can(user, "fees");
  const left = Math.max(status.aon.monthLimit - status.aon.monthUsed, 0);

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Ask Aon (Ctrl+/)"
          aria-keyshortcuts="Control+/ Meta+/"
          title="Ask Aon (Ctrl+/)"
          className="fixed bottom-20 end-4 z-40 size-14 rounded-full border border-border bg-surface p-1.5 shadow-overlay transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring motion-reduce:transition-none lg:bottom-6 print:hidden"
        >
          <AonMascot />
        </button>
      )}
      <Drawer
        open={open}
        onOpenChange={setOpen}
        size="md"
        title={
          <span className="flex items-center gap-2">
            <Sparkles className="size-4 text-brand" aria-hidden /> Aon
          </span>
        }
        description="Ask about your classes, results, attendance and fees. Aon only reads what your role can already see."
        headerExtra={<Badge tone={left === 0 ? "warning" : "neutral"}>{shortTokens(left)} AI tokens left this month</Badge>}
        bodyClassName="p-0"
      >
        <div className="h-full min-h-[24rem]">
          <AskPanel status={status} onUsed={reload} canFees={canFees} compact />
        </div>
      </Drawer>
    </>
  );
}
