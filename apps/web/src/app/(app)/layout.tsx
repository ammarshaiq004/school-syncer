"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, setToken, type Feature, type Role, type SchoolPlan, type SessionUser } from "@/lib/api";
import { day } from "@/lib/format";
import { FEES, hasRole, SessionContext, SETUP, STAFF, TEACHING } from "@/lib/session";

const NAV: { href: string; label: string; roles: Role[]; feature?: Feature }[] = [
  { href: "/dashboard", label: "Dashboard", roles: STAFF },
  { href: "/admissions", label: "Admissions", roles: SETUP, feature: "admissions" },
  { href: "/students", label: "Students", roles: STAFF },
  { href: "/attendance", label: "Attendance", roles: TEACHING },
  { href: "/timetable", label: "Timetable", roles: STAFF, feature: "timetable" },
  { href: "/homework", label: "Homework", roles: TEACHING, feature: "homework" },
  { href: "/exams", label: "Exams and results", roles: TEACHING, feature: "exams" },
  { href: "/fees", label: "Fees", roles: FEES, feature: "fees" },
  { href: "/hr", label: "HR and payroll", roles: STAFF, feature: "hr" },
  { href: "/accounts", label: "Accounts", roles: FEES, feature: "accounts" },
  { href: "/reports", label: "Reports", roles: FEES, feature: "reports" },
  { href: "/announcements", label: "Announcements", roles: STAFF },
  { href: "/messages", label: "Message log", roles: SETUP },
  { href: "/campuses", label: "Campuses", roles: SETUP },
  { href: "/classes", label: "Classes and sections", roles: SETUP },
  { href: "/users", label: "Users and roles", roles: SETUP },
  { href: "/billing", label: "Plan and billing", roles: FEES },
  { href: "/parent", label: "My children", roles: ["PARENT"] },
];

const COMING = [
  { label: "Transport", phase: 3 },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [signedInAt, setSignedInAt] = useState(0);

  useEffect(() => {
    api<SessionUser>("/auth/me")
      .then((me) => {
        setUser(me);
        setSignedInAt(Date.now());
        // Parents only have their own portal.
        if (!hasRole(me, STAFF) && !pathname.startsWith("/parent")) router.replace("/parent");
      })
      .catch(() => router.replace("/login"));
  }, [router, pathname]);

  function signOut() {
    setToken(null);
    router.replace("/login");
  }

  if (!user) {
    return <div className="p-8 text-sm opacity-60">Loading...</div>;
  }

  const features = user.plan?.features;
  const nav = NAV.filter(
    (item) => hasRole(user, item.roles) && (!item.feature || !features || features.includes(item.feature)),
  );

  return (
    <SessionContext.Provider value={user}>
      <div className="flex min-h-screen flex-col md:flex-row print:block">
        <aside className="border-b border-black/10 bg-white p-4 md:w-60 md:shrink-0 md:border-b-0 md:border-r dark:border-white/10 dark:bg-white/5 print:hidden">
          <div className="flex items-center justify-between md:mb-6">
            <Link href={nav[0]?.href ?? "/"} className="text-xl font-bold text-brand">SchoolSyncer</Link>
            <button className="text-sm md:hidden" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen}>
              Menu
            </button>
          </div>
          <nav className={`${menuOpen ? "flex" : "hidden"} mt-4 flex-col gap-1 md:mt-0 md:flex`}>
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className={`rounded-lg px-3 py-2 text-sm ${
                  pathname.startsWith(item.href)
                    ? "bg-brand/10 font-medium text-brand"
                    : "hover:bg-black/5 dark:hover:bg-white/10"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          {hasRole(user, STAFF) && (
            <div className="mt-6 hidden md:block">
              <div className="px-3 pb-1 text-xs uppercase tracking-wide opacity-50">Coming next</div>
              {COMING.map((m) => (
                <div key={m.label} className="flex justify-between px-3 py-1 text-sm opacity-50">
                  <span>{m.label}</span>
                  <span className="shrink-0 text-xs">Phase {m.phase}</span>
                </div>
              ))}
            </div>
          )}
        </aside>
        <div className="min-w-0 flex-1">
          <header className="flex items-center justify-between border-b border-black/10 px-6 py-3 dark:border-white/10 print:hidden">
            <span className="text-sm opacity-70">
              {user.name} · {[...new Set(user.roles.map((r) => r.role.toLowerCase().replace("_", " ")))].join(", ")}
            </span>
            <button onClick={signOut} className="text-sm text-brand">Sign out</button>
          </header>
          {user.plan && hasRole(user, STAFF) && <PlanBanner plan={user.plan} canBill={hasRole(user, FEES)} now={signedInAt} />}
          <main className="p-4 md:p-6 print:p-0">{children}</main>
        </div>
      </div>
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
    <div
      role="status"
      className={`flex flex-wrap items-center justify-between gap-2 px-6 py-2 text-sm print:hidden ${
        urgent ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200" : "bg-brand/10 text-brand"
      }`}
    >
      <span>{text}</span>
      {canBill && (
        <Link href="/billing" className="font-medium underline">
          {plan.status === "TRIAL" ? "Choose a plan" : "Plan and billing"}
        </Link>
      )}
    </div>
  );
}
