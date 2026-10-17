"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Activity, Building, ChartColumn, KeyRound, LayoutDashboard, LogOut, Menu, PlugZap, Receipt, ScrollText, Settings, Tags, UsersRound, Wallet, X, type LucideIcon } from "lucide-react";
import { Dialog as RDialog } from "radix-ui";
import { BrandMark } from "@/components/brand";
import { Avatar } from "@/components/kit/avatar";
import { IconButton } from "@/components/kit/button";
import { Spinner } from "@/components/kit/feedback";
import { DropdownItem, DropdownLabel, DropdownMenu, DropdownSeparator } from "@/components/kit/overlay";
import { ThemeToggle } from "@/components/kit/theme-toggle";
import { ConsoleAdminContext, PLATFORM_ROLE_LABEL, type ConsoleAdmin } from "@/components/platform/session";
import { cn } from "@/lib/cn";
import { platformApi, setPlatformToken } from "@/lib/api";
import { activeHref } from "@/lib/nav";

type NavItem = { href: string; label: string; icon: LucideIcon; ownerOnly?: boolean };

const NAV: NavItem[] = [
  { href: "/platform", label: "Overview", icon: LayoutDashboard },
  { href: "/platform/schools", label: "Schools", icon: Building },
  { href: "/platform/invoices", label: "Bills", icon: Receipt },
  { href: "/platform/payments", label: "Payments", icon: Wallet },
  { href: "/platform/plans", label: "Plans", icon: Tags },
  { href: "/platform/gateways", label: "Payment gateways", icon: PlugZap },
  { href: "/platform/reports", label: "Reports", icon: ChartColumn },
  { href: "/platform/audit", label: "Audit log", icon: ScrollText },
  { href: "/platform/system-health", label: "System health", icon: Activity },
  { href: "/platform/staff", label: "Platform staff", icon: UsersRound, ownerOnly: true },
  { href: "/platform/settings", label: "Settings", icon: Settings },
];

/** Printable pages that belong under a nav entry with a different path. */
const NAV_ALIASES: [prefix: string, href: string][] = [
  ["/platform/bills/", "/platform/invoices"],
  ["/platform/receipts/", "/platform/payments"],
];

const navFor = (admin: ConsoleAdmin) => NAV.filter((n) => !n.ownerOnly || admin.role === "OWNER");

/** The nav entry for the current page ("/platform" itself only matches exactly). */
function activeItem(pathname: string, items: NavItem[]) {
  if (pathname === "/platform") return items[0];
  const alias = NAV_ALIASES.find(([prefix]) => pathname.startsWith(prefix));
  if (alias) return items.find((n) => n.href === alias[1]);
  const href = activeHref(
    pathname,
    items.slice(1).map((n) => n.href),
  );
  return items.find((n) => n.href === href);
}

function ConsoleNav({ items, pathname, onNavigate }: { items: NavItem[]; pathname: string; onNavigate?: () => void }) {
  const active = activeItem(pathname, items)?.href;
  return (
    <nav aria-label="Console" className="flex flex-1 flex-col gap-0.5 px-3 py-4">
      <p className="px-2.5 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Console</p>
      {items.map((item) => {
        const on = item.href === active;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={on ? "page" : undefined}
            className={cn(
              "relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-indigo-400/50",
              on ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-100",
            )}
          >
            {on && <span aria-hidden className="absolute inset-y-2 start-0 w-[3px] rounded-full bg-indigo-400" />}
            <Icon className={cn("size-[18px]", on ? "text-indigo-300" : "text-slate-500")} aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function ConsoleBrand() {
  return (
    <Link
      href="/platform"
      className="flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-indigo-400/50"
    >
      <BrandMark />
      <span className="font-display text-[15px] font-semibold text-white">
        SchoolSyncer <span className="font-sans text-xs font-medium text-slate-400">Console</span>
      </span>
    </Link>
  );
}

/** SchoolSyncer's own console: every customer school, plan and bill. */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [admin, setAdmin] = useState<ConsoleAdmin | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    platformApi<ConsoleAdmin>("/auth/me")
      .then((me) => {
        // New staff and reset passwords must pick their own password first.
        if (me.mustChangePassword) router.replace("/platform/change-password");
        else setAdmin(me);
      })
      .catch(() => router.replace("/platform/login"));
  }, [router]);

  function signOut() {
    setPlatformToken(null);
    router.replace("/platform/login");
  }

  if (!admin) {
    return (
      <div className="grid min-h-dvh place-items-center bg-bg">
        <Spinner label="Loading console" />
      </div>
    );
  }

  const items = navFor(admin);

  return (
    <ConsoleAdminContext.Provider value={admin}>
      <div className="flex min-h-dvh bg-bg print:block">
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col bg-slate-950 lg:flex print:hidden">
          <div className="flex h-16 items-center border-b border-white/10 px-4">
            <ConsoleBrand />
          </div>
          <ConsoleNav items={items} pathname={pathname} />
          <div className="border-t border-white/10 p-3 text-xs text-slate-500">
            Signed in as {admin.name}, {PLATFORM_ROLE_LABEL[admin.role].toLowerCase()}
          </div>
        </aside>

        <RDialog.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <RDialog.Portal>
            <RDialog.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in lg:hidden" />
            <RDialog.Content
              aria-describedby={undefined}
              className="fixed inset-y-0 start-0 z-50 flex w-72 max-w-[85vw] flex-col bg-slate-950 shadow-overlay focus:outline-none data-[state=closed]:animate-sheet-out-left data-[state=open]:animate-sheet-in-left lg:hidden"
            >
              <RDialog.Title className="sr-only">Console menu</RDialog.Title>
              <div className="flex h-16 items-center justify-between border-b border-white/10 px-4">
                <ConsoleBrand />
                <RDialog.Close className="grid size-9 place-items-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Close menu">
                  <X className="size-[18px]" aria-hidden />
                </RDialog.Close>
              </div>
              <ConsoleNav items={items} pathname={pathname} onNavigate={() => setMenuOpen(false)} />
            </RDialog.Content>
          </RDialog.Portal>
        </RDialog.Root>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-border bg-surface/85 px-4 backdrop-blur-md md:px-6 print:hidden">
            <IconButton aria-label="Open menu" className="-ms-1.5 lg:hidden" onClick={() => setMenuOpen(true)}>
              <Menu />
            </IconButton>
            <span className="text-sm font-medium text-fg-secondary">{activeItem(pathname, items)?.label}</span>
            <div className="ms-auto flex items-center gap-1.5">
              <ThemeToggle />
              <DropdownMenu
                trigger={
                  <button
                    type="button"
                    aria-label="Account menu"
                    className="flex items-center gap-2 rounded-full p-0.5 hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring lg:rounded-lg lg:py-1 lg:pe-2.5 lg:ps-1"
                  >
                    <Avatar name={admin.name} size="sm" />
                    <span className="hidden text-[13px] font-medium text-fg lg:inline">{admin.name}</span>
                  </button>
                }
              >
                <DropdownLabel>
                  {admin.email}, {PLATFORM_ROLE_LABEL[admin.role].toLowerCase()}
                </DropdownLabel>
                <DropdownItem icon={<KeyRound />} href="/platform/change-password">
                  Change password
                </DropdownItem>
                <DropdownSeparator />
                <DropdownItem icon={<LogOut />} danger onSelect={signOut}>
                  Sign out
                </DropdownItem>
              </DropdownMenu>
            </div>
          </header>
          <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5 md:px-6 md:py-6 print:p-0">{children}</main>
        </div>
      </div>
    </ConsoleAdminContext.Provider>
  );
}
