"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const TABS = [
  { href: "/messages", label: "Message log" },
  { href: "/messages/templates", label: "Templates" },
  { href: "/messages/inbox", label: "WhatsApp inbox" },
  { href: "/messages/report", label: "Delivery report" },
];

/** The four pages of Communication > Messages. */
export function MessagesNav() {
  const path = usePathname();
  return (
    <nav aria-label="Messages" className="flex max-w-full gap-1 overflow-x-auto border-b border-border print:hidden">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={path === t.href ? "page" : undefined}
          className={cn(
            "-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
            path === t.href ? "border-primary text-brand" : "border-transparent text-fg-muted hover:text-fg",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
