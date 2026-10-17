import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarCheck, CircleCheck, Wallet } from "lucide-react";
import { BrandLockup } from "./brand";
import { ThemeToggle } from "./kit/theme-toggle";

export interface AuthShellProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Small print under the form (links). */
  footer?: ReactNode;
  /** Replace the right-hand panel content. */
  aside?: ReactNode;
  /** Where the logo links. */
  homeHref?: string;
  /** Form column width: sm (default) or md for longer forms. */
  width?: "sm" | "md";
}

/** Split-screen auth layout: form on the left, product panel on the right (desktop only). */
export function AuthShell({ eyebrow, title, description, children, footer, aside, homeHref = "/", width = "sm" }: AuthShellProps) {
  return (
    <div className="grid min-h-dvh bg-bg lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex min-w-0 flex-col px-4 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Link href={homeHref} className="rounded-lg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
            <BrandLockup />
          </Link>
          <ThemeToggle />
        </div>
        <main className={`mx-auto flex w-full ${width === "md" ? "max-w-md" : "max-w-sm"} flex-1 flex-col justify-center py-10`}>
          {eyebrow && <p className="mb-2 text-[13px] font-medium text-brand">{eyebrow}</p>}
          <h1 className="text-2xl font-semibold text-fg">{title}</h1>
          {description && <p className="mt-1.5 text-sm text-fg-muted">{description}</p>}
          <div className="mt-7">{children}</div>
          {footer && <div className="mt-6 text-[13px] text-fg-muted">{footer}</div>}
        </main>
        <p className="text-xs text-fg-disabled">
          © {new Date().getFullYear()} SchoolSyncer ·{" "}
          <Link href="/privacy" className="hover:text-fg-muted hover:underline">
            Privacy policy
          </Link>
        </p>
      </div>
      <aside className="relative hidden overflow-hidden border-s border-border bg-slate-950 lg:flex lg:flex-col lg:justify-center lg:px-14 xl:px-20">
        {aside ?? <DefaultAside />}
      </aside>
    </div>
  );
}

function DefaultAside() {
  return (
    <div className="relative mx-auto w-full max-w-lg text-slate-200">
      <p className="text-[13px] font-medium text-indigo-300">For physical, online and hybrid schools</p>
      <h2 className="mt-3 text-3xl font-semibold leading-tight text-white">
        Admissions to report cards, on one calm screen.
      </h2>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-slate-400">
        Mark attendance in seconds, send fee vouchers on WhatsApp and publish results to parents the same evening.
      </p>
      <div className="mt-10 grid gap-3">
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="flex items-center gap-2"><CalendarCheck className="size-4 text-indigo-300" aria-hidden />Attendance today</span>
            <span className="font-medium text-emerald-300">+1.8%</span>
          </div>
          <p className="mt-2 font-display text-2xl font-semibold tabular-nums text-white">94.2%</p>
          <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-white/10" aria-hidden>
            <span className="h-full w-[94%] rounded-full bg-indigo-400" />
          </div>
          <p className="mt-2 text-xs text-slate-500">1,206 of 1,284 students present across 3 campuses</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex items-center gap-2 text-xs text-slate-400"><Wallet className="size-4 text-indigo-300" aria-hidden />Fees collected in October</div>
          <p className="mt-2 font-display text-2xl font-semibold tabular-nums text-white">Rs 4,862,500</p>
          <ul className="mt-3 space-y-1.5 text-xs text-slate-400">
            {["Vouchers sent to 1,190 parents", "Receipts printed at the counter in one click", "Defaulter reminders scheduled for the 10th"].map((t) => (
              <li key={t} className="flex items-center gap-2"><CircleCheck className="size-3.5 text-emerald-300" aria-hidden />{t}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
