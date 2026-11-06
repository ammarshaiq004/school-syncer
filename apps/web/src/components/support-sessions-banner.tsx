"use client";

import { LifeBuoy, LogOut } from "lucide-react";
import { Button, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";

interface OpenSession {
  id: string;
  adminName: string;
  scope: "VIEW" | "EDIT";
  expiresAt: string;
}

/** For the school owner: SchoolSyncer staff are signed in to the school right now, with a button to end it. */
export function SupportSessionsBanner() {
  const toast = useToast();
  const { data, reload } = useApi<OpenSession[]>("/support-sessions");
  if (!data?.length) return null;

  async function end(id: string) {
    try {
      await api(`/support-sessions/${id}/end`, { method: "POST" });
      toast.success("Support session ended");
      void reload();
    } catch (e) {
      toast.error("Could not end the session", (e as Error).message);
    }
  }

  return (
    <div role="status" className="sticky bottom-0 z-40 bg-surface shadow-overlay print:hidden">
      {data.map((s) => (
        <div key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-warning/40 bg-warning-tint px-4 py-2 text-sm text-warning-text md:px-6">
          <LifeBuoy className="size-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1">
            <span className="font-semibold">SchoolSyncer support is signed in:</span> {s.adminName} ({s.scope === "VIEW" ? "view only" : "can make changes"}). Ends at{" "}
            {new Date(s.expiresAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Karachi" })}.
          </p>
          <Button type="button" size="sm" variant="secondary" icon={<LogOut />} onClick={() => void end(s.id)}>
            End session
          </Button>
        </div>
      ))}
    </div>
  );
}
