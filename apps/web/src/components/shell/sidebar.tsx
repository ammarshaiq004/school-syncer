"use client";

import Link from "next/link";
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { BrandLockup, BrandMark } from "@/components/brand";
import { Tooltip } from "@/components/kit/overlay";
import { EmptyState } from "@/components/kit/feedback";
import { CountBadge } from "@/components/kit/badge";
import { useChatUnread } from "@/components/chat/unread";
import { cn } from "@/lib/cn";
import { activeHref, STUDENT_PLACEHOLDER_ICON, type NavCount, type NavGroup, type NavItem, type ViewId } from "@/lib/nav";
import { usePersistedState } from "@/lib/persisted";

function NavEntry({ item, active, collapsed, onNavigate, count }: { item: NavItem; active: boolean; collapsed: boolean; onNavigate?: () => void; count?: number | null }) {
  const Icon = item.icon;
  const unread = count && count > 0 ? count : 0;
  const unreadText = unread ? `${unread > 99 ? "99+" : unread} unread` : "";
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? (unread ? `${item.label}, ${unreadText}` : item.label) : undefined}
      className={cn(
        "group/nav relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
        active ? "bg-primary-tint text-brand" : "text-fg-secondary hover:bg-surface-3 hover:text-fg",
        collapsed && "justify-center px-0",
      )}
    >
      {active && <span aria-hidden className="absolute inset-y-2 start-0 w-[3px] rounded-full bg-primary" />}
      <Icon
        className={cn(
          "size-[18px] shrink-0 transition-transform duration-150 group-hover/nav:translate-x-0.5 motion-reduce:group-hover/nav:translate-x-0",
          active ? "text-brand" : "text-fg-muted group-hover/nav:text-fg-secondary",
        )}
        aria-hidden
      />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {unread > 0 &&
        (collapsed ? (
          <span aria-hidden className="absolute end-2 top-1.5 size-2 rounded-full bg-primary ring-2 ring-surface" />
        ) : (
          <>
            <CountBadge count={unread} className="ms-auto" />
            <span className="sr-only">, {unreadText}</span>
          </>
        ))}
    </Link>
  );
  return collapsed ? (
    <Tooltip content={item.label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

export function SidebarNav({ groups, pathname, view, collapsed = false, onNavigate }: { groups: NavGroup[]; pathname: string; view: ViewId; collapsed?: boolean; onNavigate?: () => void }) {
  const [closed, setClosed] = usePersistedState<string[]>("schoolsyncer.nav-closed", []);
  const active = activeHref(pathname, groups.flatMap((g) => g.items.map((i) => i.href)));
  const chatUnread = useChatUnread(groups.some((g) => g.items.some((i) => i.count === "chatUnread")));
  const counts: Record<NavCount, number | null> = { chatUnread };

  if (groups.length === 0) {
    return (
      <div className="flex-1 px-3 py-4">
        {!collapsed && (
          <EmptyState
            compact
            icon={<STUDENT_PLACEHOLDER_ICON />}
            title={view === "student" ? "No pages here yet" : "Nothing to show"}
            description={view === "student" ? "Lessons, homework and results will appear here." : "This view has no pages for your account."}
          />
        )}
      </div>
    );
  }

  return (
    <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-3 py-3 [scrollbar-width:thin]">
      {groups.map((g, gi) => {
        const open = collapsed || !closed.includes(g.id) || g.items.some((i) => i.href === active);
        if (collapsed) {
          return (
            <div key={g.id} className={cn("flex flex-col gap-1", gi > 0 && "mt-2 border-t border-border pt-2")}>
              {g.items.map((i) => (
                <NavEntry key={i.href} item={i} active={i.href === active} collapsed onNavigate={onNavigate} count={i.count ? counts[i.count] : null} />
              ))}
            </div>
          );
        }
        const single = groups.length === 1 || g.id === "overview";
        return (
          <div key={g.id} className={cn(gi > 0 && "mt-3")}>
            {!single && (
              <button
                type="button"
                aria-expanded={open}
                aria-controls={`nav-${g.id}`}
                onClick={() => setClosed(open ? [...closed, g.id] : closed.filter((c) => c !== g.id))}
                className="flex w-full items-center justify-between rounded-md px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
              >
                {g.label}
                <ChevronDown className={cn("size-3.5 transition-transform duration-200", !open && "-rotate-90")} aria-hidden />
              </button>
            )}
            <div id={`nav-${g.id}`} className={cn("grid transition-[grid-template-rows] duration-200 ease-out", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
              <div className={cn("flex min-h-0 flex-col gap-0.5 overflow-hidden", !single && "pt-1")} inert={!open}>
                {g.items.map((i) => (
                  <NavEntry key={i.href} item={i} active={i.href === active} collapsed={false} onNavigate={onNavigate} count={i.count ? counts[i.count] : null} />
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </nav>
  );
}

export function Sidebar({ groups, pathname, view, viewLabel, home }: { groups: NavGroup[]; pathname: string; view: ViewId; viewLabel: string; home: string }) {
  const [collapsed, setCollapsed] = usePersistedState("schoolsyncer.sidebar-collapsed", false);
  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-e border-border bg-surface transition-[width] duration-200 ease-out lg:flex print:hidden",
        collapsed ? "w-[68px]" : "w-60",
      )}
    >
      <div className={cn("flex h-16 shrink-0 items-center border-b border-border", collapsed ? "justify-center px-2" : "px-4")}>
        <Link href={home} className="flex min-w-0 items-center rounded-lg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring" aria-label="SchoolSyncer home">
          {collapsed ? <BrandMark /> : <BrandLockup suffix={viewLabel} />}
        </Link>
      </div>
      <SidebarNav groups={groups} pathname={pathname} view={view} collapsed={collapsed} />
      <div className="shrink-0 border-t border-border p-2">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className={cn(
            "flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
            collapsed && "justify-center px-0",
          )}
        >
          {collapsed ? <PanelLeftOpen className="size-[18px]" aria-hidden /> : <PanelLeftClose className="size-[18px]" aria-hidden />}
          {!collapsed && "Collapse"}
        </button>
      </div>
    </aside>
  );
}
