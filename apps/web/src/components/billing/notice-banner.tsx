"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Alert } from "@/components/kit/feedback";
import { api } from "@/lib/api";
import { noticeTone, type PlatformNotice } from "@/lib/platform-billing";
import { useApi } from "@/lib/use-api";

/**
 * Unread WARNING and URGENT messages from SchoolSyncer (bill due today,
 * overdue, read-only tomorrow) across the top of the app. Only mount it for
 * users who can see Plan and billing. Dismissing marks the message read. A
 * failed load shows nothing: the banner must never get in the way.
 */
export function BillingNoticeBanner({ pathname }: { pathname: string }) {
  const notices = useApi<PlatformNotice[]>("/subscription/notices/unread");
  const [dismissed, setDismissed] = useState<string[]>([]);
  const { reload } = notices;
  const shownFor = useRef(pathname);

  // Pick up messages read (or newly sent) while moving around the app, e.g. on Plan and billing.
  // The first page's load is useApi's own.
  useEffect(() => {
    if (shownFor.current === pathname) return;
    shownFor.current = pathname;
    void reload();
  }, [pathname, reload]);

  // Plan and billing lists every message with its own Mark as read.
  if (pathname === "/billing" || notices.error || !notices.data) return null;
  const open = notices.data.filter((n) => !dismissed.includes(n.id) && n.severity !== "INFO");
  if (!open.length) return null;
  // The API lists newest first; show the most serious one.
  const notice = open.find((n) => n.severity === "URGENT") ?? open[0];
  const more = open.length - 1;

  function dismiss() {
    setDismissed((d) => [...d, notice.id]);
    // Best effort: if it fails the message simply shows again next time.
    api(`/subscription/notices/${notice.id}/read`, { method: "POST" }).catch(() => undefined);
  }

  return (
    <Alert
      banner
      tone={noticeTone(notice.severity) === "danger" ? "danger" : "warning"}
      className="print:hidden"
      onDismiss={dismiss}
      action={
        <Link href="/billing" className="whitespace-nowrap font-medium underline underline-offset-2 hover:no-underline">
          Plan and billing{more > 0 ? ` (${more} more)` : ""}
        </Link>
      }
    >
      <span className="font-medium">{notice.title}.</span> {notice.body}
    </Alert>
  );
}
