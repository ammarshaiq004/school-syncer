import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  Bus,
  CalendarCheck,
  ClipboardCheck,
  Laptop,
  MessageCircle,
  MonitorSmartphone,
  School,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";
import { BrandLockup } from "@/components/brand";
import { buttonClass } from "@/components/kit/button";
import { ThemeToggle } from "@/components/kit/theme-toggle";

const MODES: { icon: ReactNode; title: string; text: string; points: string[] }[] = [
  {
    icon: <School />,
    title: "Physical schools",
    text: "Registers, fee counters and report cards for every campus.",
    points: ["Attendance with WhatsApp alerts", "Fee vouchers and receipts", "Transport, library and ID cards"],
  },
  {
    icon: <Laptop />,
    title: "Online schools",
    text: "Courses, homework and results without a building.",
    points: ["Student logins and workspaces", "Homework and marks online", "Parents follow progress from home"],
  },
  {
    icon: <MonitorSmartphone />,
    title: "Hybrid schools",
    text: "Some classes on campus, some at home, one record.",
    points: ["One timetable for both", "Same gradebook and report card", "Announcements reach everyone"],
  },
];

const FEATURES: { icon: ReactNode; title: string; text: string }[] = [
  { icon: <Users />, title: "Admissions to alumni", text: "Enquiries, admission forms, student profiles, promotions and leaving certificates." },
  { icon: <CalendarCheck />, title: "Attendance in seconds", text: "Tap through a class register on any phone. Parents of absent students hear about it the same morning." },
  { icon: <Wallet />, title: "Fees that get paid", text: "Monthly vouchers, part payments, defaulter lists and reminders, all in rupees." },
  { icon: <ClipboardCheck />, title: "Exams and report cards", text: "Teachers enter marks, grades are worked out for you, and results publish to parents." },
  { icon: <Bus />, title: "Operations", text: "Transport routes, library loans, staff payroll and the school cashbook." },
  { icon: <MessageCircle />, title: "Parents in the loop", text: "A parent portal with timetables, homework, results and dues for every child." },
];

export default function Home() {
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" aria-label="SchoolSyncer home" className="rounded-lg">
            <BrandLockup />
          </Link>
          <nav className="ms-auto flex items-center gap-1.5 sm:gap-2" aria-label="Account">
            <ThemeToggle />
            <Link href="/login" className={buttonClass("ghost", "md")}>
              Sign in
            </Link>
            <Link href="/register" className={buttonClass("primary", "md", "hidden sm:inline-flex")}>
              Register your school
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-14 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pb-24 lg:pt-20">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-[13px] font-medium text-fg-secondary shadow-card">
              <ShieldCheck className="size-3.5 text-brand" aria-hidden />
              Built for schools in Pakistan
            </p>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.1] sm:text-5xl">
              Run your whole school from one calm screen.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-fg-secondary sm:text-lg">
              Admissions, attendance, fees, exams, staff and parent communication for every campus, whether your classes
              meet in a building, online, or both.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/register" className={buttonClass("primary", "md", "h-11 px-5 text-[15px]")}>
                Start free for 30 days
                <ArrowRight aria-hidden />
              </Link>
              <Link href="/login" className={buttonClass("secondary", "md", "h-11 px-5 text-[15px]")}>
                Sign in to your school
              </Link>
            </div>
            <p className="mt-4 text-[13px] text-fg-muted">Every module included during the trial. No card needed.</p>
          </div>

          <HeroPreview />
        </section>

        <section className="border-y border-border bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
            <h2 className="max-w-2xl text-2xl font-semibold sm:text-3xl">One system for the way your school teaches</h2>
            <p className="mt-3 max-w-2xl text-fg-secondary">Pick physical, online or hybrid when you sign up. The menus follow.</p>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {MODES.map((m) => (
                <div key={m.title} className="rounded-xl border border-border bg-bg p-6">
                  <span className="grid size-10 place-items-center rounded-lg bg-primary-tint text-brand [&_svg]:size-5" aria-hidden>
                    {m.icon}
                  </span>
                  <h3 className="mt-4 text-lg font-semibold">{m.title}</h3>
                  <p className="mt-1 text-sm text-fg-secondary">{m.text}</p>
                  <ul className="mt-4 space-y-2 text-sm text-fg-secondary">
                    {m.points.map((p) => (
                      <li key={p} className="flex items-center gap-2">
                        <span className="size-1.5 rounded-full bg-primary" aria-hidden />
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <h2 className="max-w-2xl text-2xl font-semibold sm:text-3xl">Everything the school office does, in one place</h2>
          <div className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex gap-4">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-surface text-brand shadow-card [&_svg]:size-[18px]" aria-hidden>
                  {f.icon}
                </span>
                <div>
                  <h3 className="text-base font-semibold">{f.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-fg-secondary">{f.text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
          <div className="flex flex-col items-start justify-between gap-6 rounded-2xl bg-slate-950 px-6 py-10 text-white sm:px-10 md:flex-row md:items-center">
            <div>
              <h2 className="text-2xl font-semibold">Ready for the new session?</h2>
              <p className="mt-2 text-slate-400">Set up classes, import students and send the first fee vouchers this week.</p>
            </div>
            <Link href="/register" className={buttonClass("primary", "md", "h-11 px-5 text-[15px]")}>
              Register your school
              <ArrowRight aria-hidden />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-[13px] text-fg-muted sm:px-6">
          <span>© SchoolSyncer</span>
          <span className="flex gap-4">
            <Link href="/verify" className="hover:text-fg">Verify a certificate</Link>
            <Link href="/platform/login" className="hover:text-fg">Staff console</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

/** Static product preview built from the design tokens (not a screenshot). */
function HeroPreview() {
  const bars = [82, 91, 88, 95, 93, 90];
  return (
    <div className="relative" aria-hidden>
      <div className="rounded-2xl border border-border bg-surface p-4 shadow-overlay sm:p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-fg-muted">Good morning, Principal</p>
            <p className="font-display text-base font-semibold">Model Town Campus</p>
          </div>
          <span className="rounded-full bg-success-tint px-2 py-0.5 text-xs font-medium text-success-text">Term 1</span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
          {[
            ["Students", "1,284"],
            ["Present", "94.2%"],
            ["Fees in", "Rs 4.86M"],
          ].map(([k, v]) => (
            <div key={k} className="min-w-0 rounded-lg border border-border bg-bg p-2 sm:p-3">
              <p className="truncate text-[11px] text-fg-muted">{k}</p>
              <p className="mt-1 truncate font-display text-sm font-semibold tabular-nums sm:text-lg">{v}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-lg border border-border p-3">
          <p className="text-xs font-medium text-fg-secondary">Attendance this week</p>
          <div className="mt-3 flex h-24 items-end gap-2">
            {bars.map((b, i) => (
              <div key={i} className="flex h-full flex-1 flex-col items-center gap-1">
                <div className="relative w-full flex-1">
                  <div className="absolute inset-x-0 bottom-0 rounded-t-[4px] bg-primary" style={{ height: `${(b - 70) * 3.2}%` }} />
                </div>
                <span className="text-[10px] text-fg-muted">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][i]}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-4 divide-y divide-border rounded-lg border border-border text-[13px]">
          {[
            ["Ayesha Khan", "Grade 7 B", "Paid", "bg-success-tint text-success-text"],
            ["Muhammad Bilal", "Grade 5 A", "Pending", "bg-warning-tint text-warning-text"],
            ["Hamza Qureshi", "Grade 9 C", "Overdue", "bg-danger-tint text-danger-text"],
          ].map(([n, c, s, t]) => (
            <div key={n} className="flex items-center justify-between px-3 py-2">
              <span className="font-medium">{n}</span>
              <span className="hidden text-fg-muted sm:inline">{c}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${t}`}>{s}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
