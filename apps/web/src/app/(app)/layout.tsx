"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, setToken, type Role, type SessionUser } from "@/lib/api";
import { FEES, hasRole, SessionContext, SETUP, STAFF, TEACHING } from "@/lib/session";

const NAV: { href: string; label: string; roles: Role[] }[] = [
  { href: "/dashboard", label: "Dashboard", roles: STAFF },
  { href: "/admissions", label: "Admissions", roles: SETUP },
  { href: "/students", label: "Students", roles: STAFF },
  { href: "/attendance", label: "Attendance", roles: TEACHING },
  { href: "/exams", label: "Exams and results", roles: TEACHING },
  { href: "/fees", label: "Fees", roles: FEES },
  { href: "/announcements", label: "Announcements", roles: STAFF },
  { href: "/messages", label: "Message log", roles: SETUP },
  { href: "/campuses", label: "Campuses", roles: SETUP },
  { href: "/classes", label: "Classes and sections", roles: SETUP },
  { href: "/users", label: "Users and roles", roles: SETUP },
  { href: "/parent", label: "My children", roles: ["PARENT"] },
];

const COMING = [
  { label: "Timetable", phase: 2 },
  { label: "HR and payroll", phase: 2 },
  { label: "Transport", phase: 3 },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    api<SessionUser>("/auth/me")
      .then((me) => {
        setUser(me);
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

  const nav = NAV.filter((item) => hasRole(user, item.roles));

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
                  <span className="text-xs">Phase {m.phase}</span>
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
          <main className="p-4 md:p-6 print:p-0">{children}</main>
        </div>
      </div>
    </SessionContext.Provider>
  );
}
