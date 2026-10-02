"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { platformApi, setPlatformToken } from "@/lib/api";

const NAV = [
  { href: "/platform", label: "Overview", exact: true },
  { href: "/platform/schools", label: "Schools" },
  { href: "/platform/invoices", label: "Bills" },
  { href: "/platform/plans", label: "Plans" },
];

/** SchoolSyncer's own console: every customer school, plan and bill. */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [admin, setAdmin] = useState<{ name: string } | null>(null);

  useEffect(() => {
    platformApi<{ name: string }>("/auth/me")
      .then(setAdmin)
      .catch(() => router.replace("/platform/login"));
  }, [router]);

  function signOut() {
    setPlatformToken(null);
    router.replace("/platform/login");
  }

  if (!admin) return <div className="p-8 text-sm opacity-60">Loading...</div>;

  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-black/10 bg-white px-4 py-3 md:px-6 dark:border-white/10 dark:bg-white/5">
        <Link href="/platform" className="text-lg font-bold text-brand">
          SchoolSyncer <span className="font-normal opacity-60">console</span>
        </Link>
        <nav className="flex flex-wrap gap-1">
          {NAV.map((item) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-lg px-3 py-1.5 text-sm ${active ? "bg-brand/10 font-medium text-brand" : "hover:bg-black/5 dark:hover:bg-white/10"}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-4 text-sm">
          <span className="opacity-70">{admin.name}</span>
          <button onClick={signOut} className="text-brand">Sign out</button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl p-4 md:p-6">{children}</main>
    </div>
  );
}
