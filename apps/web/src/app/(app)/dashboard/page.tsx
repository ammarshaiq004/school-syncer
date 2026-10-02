"use client";

import Link from "next/link";
import { Card, ErrorText, PageTitle } from "@/components/ui";
import { rupees } from "@/lib/format";
import { useApi } from "@/lib/use-api";

interface Summary {
  students: number;
  attendanceToday: { marked: number; present: number; absent: number; leave: number };
  feesThisMonth: { period: string; invoices: number; billed: number; collected: number; collectedToday: number };
  admissions: Record<string, number>;
}
interface School { name: string; slug: string; city: string | null }

const STAGES = ["ENQUIRY", "TEST_SCHEDULED", "TEST_DONE", "INTERVIEW", "OFFERED", "ADMITTED"];

export default function DashboardPage() {
  const school = useApi<School>("/school");
  const summary = useApi<Summary>("/dashboard/summary");
  const s = summary.data;
  const attendanceRate =
    s && s.attendanceToday.marked ? Math.round((s.attendanceToday.present / s.attendanceToday.marked) * 100) : null;
  const collectionRate =
    s && s.feesThisMonth.billed ? Math.round((s.feesThisMonth.collected / s.feesThisMonth.billed) * 100) : null;

  const tiles = [
    { label: "Active students", value: s?.students.toLocaleString() ?? "–", note: "", href: "/students" },
    {
      label: "Present today",
      value: attendanceRate === null ? "–" : `${attendanceRate}%`,
      note: s ? `${s.attendanceToday.absent} absent of ${s.attendanceToday.marked} marked` : "",
      href: "/attendance",
    },
    {
      label: `Fees collected (${s?.feesThisMonth.period ?? ""})`,
      value: s ? rupees(s.feesThisMonth.collected) : "–",
      note: s ? `${collectionRate ?? 0}% of ${rupees(s.feesThisMonth.billed)} billed` : "",
      href: "/fees",
    },
    {
      label: "Collected today",
      value: s ? rupees(s.feesThisMonth.collectedToday) : "–",
      note: "",
      href: "/fees",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageTitle>{school.data?.name ?? "Dashboard"}</PageTitle>
        {school.data && (
          <p className="-mt-3 text-sm opacity-70">
            School code: <strong>{school.data.slug}</strong>
            {school.data.city ? ` · ${school.data.city}` : ""} · Online admission form:{" "}
            <Link className="text-brand underline" href={`/apply/${school.data.slug}`}>/apply/{school.data.slug}</Link>
          </p>
        )}
        <ErrorText>{summary.error}</ErrorText>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href}>
            <Card className="h-full hover:border-brand">
              <div className="text-sm opacity-70">{t.label}</div>
              <div className="mt-1 text-3xl font-semibold">{t.value}</div>
              {t.note && <div className="mt-1 text-xs opacity-60">{t.note}</div>}
            </Card>
          </Link>
        ))}
      </div>
      <Card>
        <h2 className="mb-3 font-semibold">Admissions pipeline</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {STAGES.map((stage) => (
            <Link key={stage} href="/admissions" className="rounded-lg bg-black/5 p-3 dark:bg-white/10">
              <div className="text-xs opacity-60">{stage.replace("_", " ").toLowerCase()}</div>
              <div className="text-xl font-semibold">{s?.admissions[stage] ?? 0}</div>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
