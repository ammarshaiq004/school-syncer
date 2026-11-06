"use client";

import { GraduationCap, TrendingDown, Users } from "lucide-react";
import { BarChart, Card, CardHeader, DonutChart, KpiCard, StatGrid } from "@/components/ui";
import { ReportBody } from "@/components/reports/shared";
import { useApi } from "@/lib/use-api";

interface Rate { name: string; passed: number; failed: number; passPct: number }
interface Insights {
  year: { id: string; name: string } | null;
  gender: { overall: Record<string, number>; byClass: { name: string; male: number; female: number; other: number }[] };
  dropout: { year: string; enrolled: number; left: number; transferred: number; dropoutPct: number }[];
  passFail: { byExam: Rate[]; byClass: Rate[] };
}

const num = (n: number) => n.toLocaleString("en-PK");

function PassFail({ title, rows }: { title: string; rows: Rate[] }) {
  return (
    <Card>
      <CardHeader title={title} />
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-fg-muted">No published results yet.</p>
      ) : (
        <BarChart
          label={title}
          categories={rows.map((r) => r.name)}
          series={[
            { name: "Passed", values: rows.map((r) => r.passed), color: "var(--success)" },
            { name: "Failed", values: rows.map((r) => r.failed), color: "var(--danger)" },
          ]}
          stacked
        />
      )}
    </Card>
  );
}

/** Graphs of who the students are, who leaves and how they do in exams. */
export function SchoolInsights() {
  const report = useApi<Insights>("/reports/insights");
  return (
    <div className="pt-5">
      <ReportBody report={report} kpis={3}>
        {(r) => {
          const g = r.gender.overall;
          const total = (g.MALE ?? 0) + (g.FEMALE ?? 0) + (g.OTHER ?? 0);
          const last = r.dropout.at(-1);
          const results = r.passFail.byExam.reduce((s, e) => s + e.passed + e.failed, 0);
          const passed = r.passFail.byExam.reduce((s, e) => s + e.passed, 0);
          return (
            <>
              <StatGrid cols={3}>
                <KpiCard label="Active students" value={num(total)} icon={<Users />} />
                <KpiCard label="Dropout, latest year" value={last ? `${last.dropoutPct}%` : "No data"} icon={<TrendingDown />} tone="warning" hint={last ? `${last.year}: ${num(last.left + last.transferred)} of ${num(last.enrolled)}` : undefined} />
                <KpiCard label="Pass rate" value={results ? `${Math.round((passed / results) * 1000) / 10}%` : "No results"} icon={<GraduationCap />} tone="success" hint={r.year ? `Published exams, ${r.year.name}` : undefined} />
              </StatGrid>
              <div className="mt-6 grid gap-6 lg:grid-cols-3">
                <Card>
                  <CardHeader title="Gender" />
                  <DonutChart
                    label="Students by gender"
                    data={[
                      { label: "Boys", value: g.MALE ?? 0 },
                      { label: "Girls", value: g.FEMALE ?? 0 },
                      ...(g.OTHER ? [{ label: "Other", value: g.OTHER }] : []),
                    ]}
                    centerValue={num(total)}
                    centerLabel="students"
                  />
                </Card>
                <Card className="lg:col-span-2">
                  <CardHeader title="Gender by class" />
                  {r.gender.byClass.length === 0 ? (
                    <p className="py-6 text-center text-sm text-fg-muted">No students yet.</p>
                  ) : (
                    <BarChart
                      label="Boys and girls by class"
                      categories={r.gender.byClass.map((c) => c.name)}
                      series={[
                        { name: "Boys", values: r.gender.byClass.map((c) => c.male) },
                        { name: "Girls", values: r.gender.byClass.map((c) => c.female) },
                      ]}
                      stacked
                    />
                  )}
                </Card>
              </div>
              <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader title="Dropout by year" description="Students who left or moved to another school, as a share of those enrolled" />
                  {r.dropout.length === 0 ? (
                    <p className="py-6 text-center text-sm text-fg-muted">No enrolment history yet.</p>
                  ) : (
                    <BarChart
                      label="Students who left, by academic year"
                      categories={r.dropout.map((d) => d.year)}
                      series={[
                        { name: "Left", values: r.dropout.map((d) => d.left), color: "var(--danger)" },
                        { name: "Transferred", values: r.dropout.map((d) => d.transferred), color: "var(--warning)" },
                      ]}
                      stacked
                    />
                  )}
                </Card>
                <PassFail title="Pass and fail by exam" rows={r.passFail.byExam} />
              </div>
              <div className="mt-6">
                <PassFail title="Pass and fail by class" rows={r.passFail.byClass} />
              </div>
            </>
          );
        }}
      </ReportBody>
    </div>
  );
}
