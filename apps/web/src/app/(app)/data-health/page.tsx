"use client";

import { CircleCheck, HeartPulse, RefreshCw } from "lucide-react";
import Link from "next/link";
import { Badge, Button, buttonClass, Card, CardHeader, EmptyState, ErrorState, PageHeader, SkeletonRows } from "@/components/ui";
import { useApi } from "@/lib/use-api";

interface Check {
  key: string;
  title: string;
  severity: "error" | "warning";
  count: number;
  items: { id: string; label: string; detail?: string }[];
  href: string;
  help: string;
}
interface Health {
  checkedAt: string;
  students: number;
  score: number;
  checks: Check[];
}

/** School-side data health checker: records that quietly break attendance, fees, messages and certificates. */
export default function DataHealthPage() {
  const health = useApi<Health>("/data-health");
  const d = health.data;
  const problems = d?.checks.filter((c) => c.count) ?? [];
  const passed = d?.checks.filter((c) => !c.count) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Data health"
        description="Finds missing or inconsistent records before they cause trouble in attendance, fees, messages and certificates."
        breadcrumbs={[{ label: "Setup" }, { label: "Data health" }]}
        actions={
          <Button type="button" variant="secondary" icon={<RefreshCw />} onClick={() => void health.reload()}>
            Check again
          </Button>
        }
      />
      {health.error ? (
        <Card padding="none">
          <ErrorState message={health.error} onRetry={health.reload} />
        </Card>
      ) : !d ? (
        <Card>
          <SkeletonRows rows={6} />
        </Card>
      ) : (
        <>
          <Card className="flex flex-wrap items-center gap-4">
            <div className="text-4xl font-semibold tabular-nums" aria-label={`Health score ${d.score} out of 100`}>
              {d.score}
              <span className="text-lg text-fg-muted">/100</span>
            </div>
            <p className="text-sm text-fg-muted">
              {problems.length
                ? `${problems.length} thing${problems.length === 1 ? "" : "s"} to look at across ${d.students} active students.`
                : `Everything checked out across ${d.students} active students.`}
            </p>
          </Card>
          {!problems.length ? (
            <Card>
              <EmptyState icon={<CircleCheck />} title="No problems found" description="Run the check again after big imports or at the start of a term." />
            </Card>
          ) : (
            <ul className="flex flex-col gap-3">
              {problems.map((c) => (
                <li key={c.key}>
                  <Card>
                    <CardHeader
                      icon={<HeartPulse />}
                      title={c.title}
                      description={c.help}
                      action={
                        <div className="flex items-center gap-2">
                          <Badge tone={c.severity === "error" ? "danger" : "warning"}>{c.count}</Badge>
                          <Link href={c.href} className={buttonClass("secondary", "sm")}>
                            Fix
                          </Link>
                        </div>
                      }
                    />
                    <ul className="mt-3 divide-y divide-border text-sm">
                      {c.items.map((i) => (
                        <li key={i.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                          <span>{i.label}</span>
                          {i.detail && <span className="text-fg-muted">{i.detail}</span>}
                        </li>
                      ))}
                    </ul>
                    {c.count > c.items.length && <p className="mt-2 text-xs text-fg-muted">and {c.count - c.items.length} more</p>}
                  </Card>
                </li>
              ))}
            </ul>
          )}
          {!!passed.length && (
            <p className="text-sm text-fg-muted">
              Passed: {passed.map((c) => c.title.toLowerCase()).join("; ")}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
