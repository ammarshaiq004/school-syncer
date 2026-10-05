"use client";

import { useState } from "react";
import { LifeBuoy, LogOut } from "lucide-react";
import { Button } from "@/components/ui";
import { endSupportSession, getSupportInfo } from "@/lib/api";

/**
 * Sticky amber bar (pinned to the bottom of the window, clear of the top bar) on every school page during a support session, so it is
 * always clear that SchoolSyncer staff are acting as the school's owner.
 */
export function SupportBanner({ adminName }: { adminName: string }) {
  // Read once: the info is written before the tab reaches the school app.
  const [info] = useState(getSupportInfo);
  const until = info.expiresAt ? new Date(info.expiresAt) : null;

  function end() {
    endSupportSession();
    // Tabs opened by the console can close themselves; otherwise show the ended page.
    window.close();
    window.location.replace("/support/ended");
  }

  return (
    // Opaque base under the tint so page content never shows through in dark mode.
    <div role="status" className="sticky bottom-0 z-40 bg-surface shadow-overlay print:hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-warning/40 bg-warning-tint px-4 py-2 text-sm text-warning-text md:px-6">
        <LifeBuoy className="size-4 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1">
          <span className="font-semibold">Support session:</span> {adminName} viewing {info.schoolName ?? "this school"} as its owner.
          {until && !Number.isNaN(until.getTime()) && <span> Ends at {until.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Karachi" })}.</span>}
        </p>
        <Button type="button" size="sm" variant="secondary" icon={<LogOut />} onClick={end}>
          End session
        </Button>
      </div>
    </div>
  );
}
