"use client";

import { useState } from "react";
import { Printer } from "lucide-react";
import { Button, Card, EmptyState, ErrorState, PageHeader, SelectField, SkeletonRows } from "@/components/ui";
import { day } from "@/lib/format";
import { useSectionOptions } from "@/lib/sections";
import { useApi } from "@/lib/use-api";

interface Slips {
  className: string;
  printedOn: string;
  slips: {
    admissionNo: string;
    rollNo: number | null;
    name: string;
    gender: string;
    dateOfBirth: string | null;
    address: string | null;
    guardians: { name: string; relation: string; phone: string }[];
  }[];
}

/** One slip per student for the class, sent home for parents to check and correct. */
export default function SlipsPage() {
  const sections = useSectionOptions({ campusScoped: true });
  const [sectionId, setSectionId] = useState("");
  const school = useApi<{ name: string }>("/school");
  const data = useApi<Slips>(sectionId ? `/front-office/slips?sectionId=${sectionId}` : null);

  return (
    <div className="flex flex-col gap-6">
      <div className="print:hidden">
        <PageHeader
          title="Student slips"
          description="Print each child's details for the class so parents can check them and mark corrections."
          breadcrumbs={[{ label: "Operations" }, { label: "Front office", href: "/front-office" }, { label: "Student slips" }]}
          actions={
            <Button icon={<Printer />} disabled={!data.data?.slips.length} onClick={() => window.print()}>
              Print
            </Button>
          }
        />
        <div className="mt-4 max-w-sm">
          <SelectField
            label="Class and section"
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            options={[{ value: "", label: "Choose a class" }, ...sections.options]}
          />
        </div>
      </div>
      {!sectionId ? (
        <Card className="print:hidden">
          <EmptyState title="Choose a class to prepare its slips" />
        </Card>
      ) : data.error ? (
        <ErrorState message={data.error} onRetry={data.reload} />
      ) : !data.data ? (
        <Card>
          <SkeletonRows rows={4} columns={2} />
        </Card>
      ) : !data.data.slips.length ? (
        <Card>
          <EmptyState title="No current students in this class" />
        </Card>
      ) : (
        <div className="grid gap-4 print:block">
          {data.data.slips.map((s) => (
            <article
              key={s.admissionNo}
              className="break-inside-avoid rounded-xl border border-border bg-surface p-5 text-sm print:mb-4 print:rounded-none print:border-black print:bg-white print:p-3 print:text-black"
            >
              <header className="mb-3 flex items-baseline justify-between gap-3 border-b border-border pb-2 print:border-black">
                <h2 className="font-display text-base font-semibold">{school.data?.name ?? "Student information slip"}</h2>
                <span className="text-xs">Class {data.data!.className} · printed {day(data.data!.printedOn)}</span>
              </header>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-4">
                <Row label="Name" value={s.name} />
                <Row label="Admission no." value={s.admissionNo} />
                <Row label="Roll no." value={s.rollNo?.toString() ?? "-"} />
                <Row label="Gender" value={s.gender.charAt(0) + s.gender.slice(1).toLowerCase()} />
                <Row label="Date of birth" value={s.dateOfBirth ? day(s.dateOfBirth) : "Not recorded"} />
                <div className="col-span-2 sm:col-span-3">
                  <Row label="Address" value={s.address ?? "Not recorded"} />
                </div>
                {s.guardians.map((g, i) => (
                  <div key={i} className="col-span-2">
                    <Row label={g.relation} value={`${g.name}, ${g.phone}`} />
                  </div>
                ))}
              </dl>
              <p className="mt-3 border-t border-dashed border-border pt-2 text-xs print:border-black">
                Corrections: ______________________________________________  Parent signature: ______________
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-fg-muted print:text-black">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
