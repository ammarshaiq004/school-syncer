"use client";

import Link from "next/link";
import { Bell, Bug, ChevronDown, KeyRound, LogOut, Menu, Moon, Search, Sun } from "lucide-react";
import { Avatar } from "@/components/kit/avatar";
import { IconButton } from "@/components/kit/button";
import { DropdownItem, DropdownLabel, DropdownMenu, DropdownSeparator, Tooltip } from "@/components/kit/overlay";
import { ThemeToggle } from "@/components/kit/theme-toggle";
import { cn } from "@/lib/cn";
import { VIEWS, viewDef, type ViewId } from "@/lib/nav";
import { useTheme } from "@/lib/theme";

const ICON_LINK =
  "relative grid size-9 place-items-center rounded-lg text-fg-secondary transition-colors hover:bg-surface-3 hover:text-fg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring [&_svg]:size-[18px]";

export function roleLabel(roles: { role: string }[]) {
  return [...new Set(roles.map((r) => r.role))].map((r) => r.charAt(0) + r.slice(1).toLowerCase().replace(/_/g, " ")).join(", ");
}

export interface TopBarProps {
  name: string;
  roles: { role: string }[];
  view: ViewId;
  available: ViewId[];
  onSwitchView: (v: ViewId) => void;
  onOpenMenu: () => void;
  onOpenPalette: () => void;
  onSignOut: () => void;
  /** Opens "Report a problem" (SCHOOL-150). */
  onReportProblem: () => void;
  /** Where "Change password" goes; omitted to hide it (support sessions). */
  changePasswordHref?: string;
  showBell: boolean;
  /** What the search button offers, e.g. "Search students and pages". */
  searchLabel?: string;
}

export function TopBar({ name, roles, view, available, onSwitchView, onOpenMenu, onOpenPalette, onSignOut, onReportProblem, changePasswordHref, showBell, searchLabel = "Search pages" }: TopBarProps) {
  const current = viewDef(view);
  const [theme, setTheme] = useTheme();
  const CurrentIcon = current.icon;
  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-border bg-surface/85 px-4 backdrop-blur-md md:px-6 print:hidden">
      <IconButton aria-label="Open menu" className="-ms-1.5 lg:hidden" onClick={onOpenMenu}>
        <Menu />
      </IconButton>

      <button
        type="button"
        onClick={onOpenPalette}
        aria-label={`${searchLabel} (Ctrl+K)`}
        aria-keyshortcuts="Control+K Meta+K"
        className="hidden h-9 w-full max-w-xs items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 text-sm text-fg-muted transition-colors hover:border-border-strong hover:text-fg-secondary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring sm:flex"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="flex-1 truncate text-left">{searchLabel}</span>
        <kbd className="rounded border border-border bg-surface px-1.5 font-sans text-[10px] font-semibold">Ctrl K</kbd>
      </button>
      <IconButton aria-label={searchLabel} className="sm:hidden" onClick={onOpenPalette}>
        <Search />
      </IconButton>

      <div className="ms-auto flex items-center gap-1 sm:gap-1.5">
        <DropdownMenu
          trigger={
            <button
              type="button"
              aria-label={`View: ${current.label}. Switch view`}
              className="group flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-2.5 text-[13px] font-medium text-fg shadow-card transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
            >
              <CurrentIcon className="size-4 text-brand" aria-hidden />
              <span className="hidden md:inline">{current.label}</span>
              <span className="md:hidden">{current.short}</span>
              <ChevronDown className="size-3.5 text-fg-muted transition-transform duration-150 group-data-[state=open]:rotate-180" aria-hidden />
            </button>
          }
          className="w-72"
        >
          <DropdownLabel>Switch view</DropdownLabel>
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const can = available.includes(v.id);
            return (
              <DropdownItem
                key={v.id}
                icon={<Icon />}
                description={v.description}
                selected={v.id === view}
                disabledReason={can ? undefined : "Your account does not have this role"}
                onSelect={() => onSwitchView(v.id)}
              >
                {v.label}
              </DropdownItem>
            );
          })}
        </DropdownMenu>

        <ThemeToggle className="hidden sm:inline-flex" />

        <Tooltip content="Report a problem" side="bottom">
          <IconButton aria-label="Report a problem" onClick={onReportProblem}>
            <Bug />
          </IconButton>
        </Tooltip>

        {showBell && (
          <Tooltip content="Announcements" side="bottom">
            <Link href="/announcements" className={ICON_LINK} aria-label="Announcements">
              <Bell aria-hidden />
            </Link>
          </Tooltip>
        )}

        <DropdownMenu
          trigger={
            <button
              type="button"
              aria-label="Account menu"
              className="group ms-1 flex items-center gap-2 rounded-full p-0.5 transition-colors hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring lg:rounded-lg lg:py-1 lg:pe-2 lg:ps-1"
            >
              <Avatar name={name} size="sm" />
              <span className="hidden min-w-0 flex-col text-left lg:flex">
                <span className="max-w-36 truncate text-[13px] font-medium leading-tight text-fg">{name}</span>
                <span className="max-w-36 truncate text-[11px] leading-tight text-fg-muted">{roleLabel(roles)}</span>
              </span>
              <ChevronDown className={cn("hidden size-3.5 text-fg-muted transition-transform duration-150 group-data-[state=open]:rotate-180 lg:block")} aria-hidden />
            </button>
          }
          className="w-64"
        >
          <div className="flex items-center gap-3 px-2.5 py-2">
            <Avatar name={name} size="md" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-fg">{name}</p>
              <p className="truncate text-xs text-fg-muted">{roleLabel(roles)}</p>
            </div>
          </div>
          <DropdownSeparator />
          <DropdownItem icon={theme === "dark" ? <Sun /> : <Moon />} onSelect={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? "Light theme" : "Dark theme"}
          </DropdownItem>
          {changePasswordHref && (
            <DropdownItem icon={<KeyRound />} href={changePasswordHref}>
              Change password
            </DropdownItem>
          )}
          <DropdownItem icon={<Bug />} onSelect={onReportProblem}>
            Report a problem
          </DropdownItem>
          <DropdownSeparator />
          <DropdownItem icon={<LogOut />} danger onSelect={onSignOut}>
            Sign out
          </DropdownItem>
        </DropdownMenu>
      </div>
    </header>
  );
}
