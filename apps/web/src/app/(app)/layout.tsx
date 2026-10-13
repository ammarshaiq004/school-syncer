"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { GraduationCap, KeyRound, Lock, LogOut, Moon, X } from "lucide-react";
import { Dialog as RDialog } from "radix-ui";
import { BrandLockup, BrandMark } from "@/components/brand";
import { Alert, EmptyState } from "@/components/kit/feedback";
import { buttonClass } from "@/components/kit/button";
import { CommandPalette, type PaletteCommand } from "@/components/kit/command-palette";
import { Spinner } from "@/components/kit/feedback";
import { Sidebar, SidebarNav } from "@/components/shell/sidebar";
import { TopBar } from "@/components/shell/topbar";
import { SupportBanner } from "@/components/platform/support-banner";
import { api, endSupportSession, getSupportToken, setToken, type SchoolPlan, type SessionUser } from "@/lib/api";
import { day, fullName } from "@/lib/format";
import { allNavItems, availableViews, blockedNavItem, navForView, resolveView, VIEWS, viewDef, viewFromPath, type ViewId } from "@/lib/nav";
import { usePersistedState } from "@/lib/persisted";
import { FEES, hasRole, SessionContext, STAFF } from "@/lib/session";
import { setTheme } from "@/lib/theme";

/** The parts of GET /students the command palette shows. */
interface PaletteStudent {
  id: string;
  firstName: string;
  lastName: string | null;
  admissionNo: string;
  enrollments: { section: { name: string; class: { name: string } } }[];
}

/** True when a parent or student account is on a page outside their own portal. */
function outsidePortal(user: SessionUser, pathname: string) {
  if (hasRole(user, STAFF)) return false;
  const area = viewFromPath(pathname);
  return !(area === "student" && hasRole(user, ["STUDENT"])) && !(area === "parent" && hasRole(user, ["PARENT"]));
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [signedInAt, setSignedInAt] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [savedView, setSavedView] = usePersistedState<ViewId | null>("schoolsyncer.view", null);

  useEffect(() => {
    api<SessionUser>("/auth/me")
      .then((me) => {
        // A password someone else issued must be replaced before anything else.
        if (me.mustChangePassword) {
          router.replace("/change-password");
          return;
        }
        setUser(me);
        setSignedInAt(Date.now());
        // Parents and students only have their own portals (an account with both can use either).
        if (outsidePortal(me, pathname)) {
          router.replace(hasRole(me, ["STUDENT"]) && !hasRole(me, ["PARENT"]) ? "/student" : "/parent");
        }
      })
      .catch(() => {
        // An expired or rejected support session ends in this tab only.
        if (getSupportToken()) {
          endSupportSession();
          router.replace("/support/ended");
        } else router.replace("/login");
      });
  }, [router, pathname]);

  const available = useMemo(() => (user ? availableViews(user) : []), [user]);
  const view: ViewId = resolveView(pathname, savedView, available);
  const mode = user?.school?.mode ?? null;
  const groups = useMemo(() => (user ? navForView({ user, view, mode }) : []), [user, view, mode]);

  function signOut() {
    setToken(null);
    router.replace("/login");
  }

  function switchView(v: ViewId) {
    if (!available.includes(v)) return;
    setSavedView(v);
    setMenuOpen(false);
    router.push(viewDef(v).home);
  }

  const commands = useMemo<PaletteCommand[]>(() => {
    if (!user) return [];
    const pages: PaletteCommand[] = allNavItems(user, mode).map((i) => ({
      id: `page-${i.href}`,
      label: i.label,
      group: i.group,
      icon: i.icon,
      href: i.href,
      keywords: i.keywords,
      hint: i.href,
    }));
    const views: PaletteCommand[] = VIEWS.filter((v) => available.includes(v.id) && v.id !== view).map((v) => ({
      id: `view-${v.id}`,
      label: `Switch to ${v.label}`,
      group: "Views",
      icon: v.icon,
      onSelect: () => switchView(v.id),
    }));
    const actions: PaletteCommand[] = [
      {
        id: "theme",
        label: "Toggle dark theme",
        group: "Actions",
        icon: Moon,
        keywords: "light dark mode appearance",
        onSelect: () => setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark"),
      },
      ...(user.support
        ? []
        : [{ id: "password", label: "Change password", group: "Actions", icon: KeyRound, keywords: "password security", href: "/change-password" }]),
      { id: "signout", label: "Sign out", group: "Actions", icon: LogOut, keywords: "log out logout", onSelect: signOut },
    ];
    return [...pages, ...views, ...actions];
    // switchView/signOut are stable enough for a palette list; rebuild when the user or view changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, available, view, mode]);

  // Ctrl+K also finds students, for roles that can open the directory.
  const canFindStudents = !!user && allNavItems(user, mode).some((i) => i.href === "/students");
  const searchStudents = useMemo(() => {
    if (!canFindStudents) return undefined;
    return async (query: string): Promise<PaletteCommand[]> => {
      const rows = await api<PaletteStudent[]>(`/students?search=${encodeURIComponent(query)}`);
      return rows.slice(0, 5).map((row) => {
        const enrolment = row.enrollments[0];
        return {
          id: `student-${row.id}`,
          label: fullName(row),
          group: "Students",
          icon: GraduationCap,
          href: `/students/${row.id}`,
          hint: [row.admissionNo, enrolment && `${enrolment.section.class.name} ${enrolment.section.name}`].filter(Boolean).join(" · "),
        };
      });
    };
  }, [canFindStudents]);

  // Also hold the page while a parent or student is being sent to their portal, so staff pages never load (and call staff APIs).
  if (!user || outsidePortal(user, pathname)) {
    return (
      <div className="grid min-h-dvh place-items-center bg-bg">
        <div className="flex flex-col items-center gap-4">
          <BrandMark className="size-10 animate-pulse motion-reduce:animate-none" />
          <Spinner label="Loading your school" />
        </div>
      </div>
    );
  }

  const home = viewDef(view).home;
  const isStaff = hasRole(user, STAFF);
  const blocked = blockedNavItem(user, pathname);

  return (
    <SessionContext.Provider value={user}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-overlay"
      >
        Skip to content
      </a>
      <div className="flex min-h-dvh bg-bg print:block print:bg-white">
        <Sidebar groups={groups} pathname={pathname} view={view} viewLabel={viewDef(view).short} home={home} />

        <RDialog.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <RDialog.Portal>
            <RDialog.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in lg:hidden" />
            <RDialog.Content
              aria-describedby={undefined}
              className="fixed inset-y-0 start-0 z-50 flex w-72 max-w-[85vw] flex-col border-e border-border bg-surface shadow-overlay focus:outline-none data-[state=closed]:animate-sheet-out-left data-[state=open]:animate-sheet-in-left lg:hidden"
            >
              <RDialog.Title className="sr-only">Menu</RDialog.Title>
              <div className="flex h-16 shrink-0 items-center justify-between border-b border-border px-4">
                <Link href={home} onClick={() => setMenuOpen(false)} aria-label="SchoolSyncer home">
                  <BrandLockup suffix={viewDef(view).short} />
                </Link>
                <RDialog.Close className="grid size-9 place-items-center rounded-lg text-fg-muted hover:bg-surface-3 hover:text-fg" aria-label="Close menu">
                  <X className="size-[18px]" aria-hidden />
                </RDialog.Close>
              </div>
              <SidebarNav groups={groups} pathname={pathname} view={view} onNavigate={() => setMenuOpen(false)} />
            </RDialog.Content>
          </RDialog.Portal>
        </RDialog.Root>

        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            name={user.name}
            roles={user.roles}
            view={view}
            available={available}
            onSwitchView={switchView}
            onOpenMenu={() => setMenuOpen(true)}
            onOpenPalette={() => setPaletteOpen(true)}
            onSignOut={signOut}
            // A support session acts as the owner, so it cannot change their password.
            changePasswordHref={user.support ? undefined : "/change-password"}
            showBell={isStaff}
            searchLabel={canFindStudents ? "Search students and pages" : undefined}
          />
          {user.plan && isStaff && <PlanBanner plan={user.plan} canBill={hasRole(user, FEES)} now={signedInAt} />}
          <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5 focus:outline-none md:px-6 md:py-6 print:max-w-none print:p-0">
            {blocked ? (
              <EmptyState
                icon={<Lock />}
                title={`You don't have access to ${blocked.label}`}
                description="Your role does not include this part of the school. Ask the school owner or principal if you need it."
                action={
                  <Link href={home} className={buttonClass("secondary")}>
                    Back to the dashboard
                  </Link>
                }
              />
            ) : (
              children
            )}
          </main>
          {user.support && <SupportBanner adminName={user.support.adminName} />}
        </div>
      </div>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        commands={commands}
        placeholder={canFindStudents ? "Search students and pages" : undefined}
        onSearch={searchStudents}
      />
    </SessionContext.Provider>
  );
}

/** Tells staff when the school is on a trial or can't make changes. */
function PlanBanner({ plan, canBill, now }: { plan: SchoolPlan; canBill: boolean; now: number }) {
  const daysLeft = plan.trialEndsAt ? Math.ceil((new Date(plan.trialEndsAt).getTime() - now) / 86_400_000) : null;
  let text: string;
  let urgent = false;
  if (plan.access !== "full") {
    text = `${plan.reason ?? "The school can't make changes right now."} You can still look everything up.`;
    urgent = true;
  } else if (plan.status === "TRIAL" && daysLeft !== null) {
    text = `Free trial of the ${plan.name} plan: ${daysLeft <= 1 ? "ends today" : `${daysLeft} days left`}, until ${day(plan.trialEndsAt!)}.`;
    urgent = daysLeft <= 7;
  } else {
    return null;
  }
  return (
    <Alert
      banner
      tone={urgent ? "warning" : "primary"}
      className="print:hidden"
      action={
        canBill && (
          <Link href="/billing" className="whitespace-nowrap font-medium underline underline-offset-2 hover:no-underline">
            {plan.status === "TRIAL" ? "Choose a plan" : "Plan and billing"}
          </Link>
        )
      }
    >
      {text}
    </Alert>
  );
}
