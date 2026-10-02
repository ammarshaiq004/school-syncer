"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, setToken, type SessionUser } from "@/lib/api";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/campuses", label: "Campuses" },
  { href: "/classes", label: "Classes and sections" },
  { href: "/users", label: "Users and roles" },
];

// Modules from the roadmap, shown so staff can see what is coming.
const COMING = [
  { label: "Admissions", phase: 1 },
  { label: "Students", phase: 1 },
  { label: "Attendance", phase: 1 },
  { label: "Fees and payments", phase: 1 },
  { label: "Communication", phase: 1 },
  { label: "Exams and results", phase: 2 },
  { label: "Timetable", phase: 2 },
  { label: "HR and payroll", phase: 2 },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    api<SessionUser>("/auth/me")
      .then(setUser)
      .catch(() => router.replace("/login"));
  }, [router]);

  function signOut() {
    setToken(null);
    router.replace("/login");
  }

  if (!user) {
    return <div className="p-8 text-sm opacity-60">Loading...</div>;
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-black/10 bg-white p-4 md:w-64 md:border-b-0 md:border-r dark:border-white/10 dark:bg-white/5">
        <div className="mb-6 text-xl font-bold text-brand">SchoolSyncer</div>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-lg px-3 py-2 text-sm ${
                pathname === item.href
                  ? "bg-brand/10 font-medium text-brand"
                  : "hover:bg-black/5 dark:hover:bg-white/10"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-6 hidden md:block">
          <div className="px-3 pb-1 text-xs uppercase tracking-wide opacity-50">Coming soon</div>
          {COMING.map((m) => (
            <div key={m.label} className="flex justify-between px-3 py-1 text-sm opacity-50">
              <span>{m.label}</span>
              <span className="text-xs">Phase {m.phase}</span>
            </div>
          ))}
        </div>
      </aside>
      <div className="flex-1">
        <header className="flex items-center justify-between border-b border-black/10 px-6 py-3 dark:border-white/10">
          <span className="text-sm opacity-70">
            {user.name} · {user.roles.map((r) => r.role.toLowerCase()).join(", ")}
          </span>
          <button onClick={signOut} className="text-sm text-brand">Sign out</button>
        </header>
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
