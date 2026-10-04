import Link from "next/link";
import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { BrandLockup } from "@/components/brand";
import { ThemeToggle } from "@/components/kit/theme-toggle";

/** Public page frame for the certificate check: logo bar, centred column, short footer. */
export function VerifyShell({ title, description, children }: { title: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-16 max-w-xl items-center justify-between px-4">
          <Link href="/" className="rounded-lg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
            <BrandLockup />
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-10">
        <div className="flex items-start gap-3.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-tint text-brand" aria-hidden>
            <ShieldCheck className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-fg sm:text-2xl">{title}</h1>
            {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
          </div>
        </div>
        {children}
      </main>
      <footer className="px-4 pb-6 text-center text-xs text-fg-disabled">Certificate checks are provided by SchoolSyncer for the issuing school.</footer>
    </div>
  );
}
