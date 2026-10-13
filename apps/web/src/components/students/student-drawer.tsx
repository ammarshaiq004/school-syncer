"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  CalendarCheck,
  ChartNoAxesColumn,
  ExternalLink,
  MessageCircle,
  Pencil,
  Phone,
  ShieldPlus,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  buttonClass,
  CalendarHeatmap,
  DescriptionList,
  Drawer,
  EmptyState,
  ErrorState,
  LetterGrade,
  ProgressBar,
  RadarChart,
  SkeletonRows,
  StatusPill,
  TabPanel,
  Tabs,
  type TabItem,
} from "@/components/ui";
import { day, rupees } from "@/lib/format";
import { formatCnic } from "@/lib/identity";
import {
  ATTENDANCE_LEGEND,
  ATTENDANCE_TONE,
  classLabel,
  rateTone,
  whatsappNumber,
  type DirectoryRow,
  type StudentPerformance,
  type StudentProfile,
} from "./directory-types";
import type { DirectoryPermissions, StudentAction } from "./student-actions";
import { useKeyedApi } from "./use-keyed-api";

const STATUS_WORD = { PRESENT: "present", LATE: "late", ABSENT: "absent", LEAVE: "on leave" } as const;

/** Right-hand quick view of a directory row: bio, guardians, results, attendance and fees. */
export function StudentDrawer({
  row,
  onClose,
  perms,
  onAction,
  onRecordPayment,
}: {
  row: DirectoryRow | null;
  onClose: () => void;
  perms: DirectoryPermissions;
  onAction: (action: StudentAction) => void;
  onRecordPayment: (id: string, name: string) => void;
}) {
  const [tab, setTab] = useState("bio");
  const id = row?.id ?? null;
  const profileApi = useKeyedApi<StudentProfile>(id ? `/students/${id}` : null);
  const perfApi = useKeyedApi<StudentPerformance>(id ? `/students/${id}/performance` : null);
  const profile = profileApi.data;
  const perf = perfApi.data;

  const tabs: TabItem[] = [
    { value: "bio", label: "Bio", icon: <UserRound /> },
    { value: "contact", label: "Emergency contact", icon: <Phone /> },
    { value: "performance", label: "Performance", icon: <ChartNoAxesColumn /> },
    { value: "attendance", label: "Attendance", icon: <CalendarCheck /> },
    ...(perms.fees ? [{ value: "fees", label: "Fees", icon: <Wallet /> }] : []),
  ];

  const cls = row ? classLabel(row) : null;

  return (
    <Drawer
      open={row !== null}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setTab("bio");
        }
      }}
      size="lg"
      title={
        row ? (
          <span className="flex items-center gap-3">
            <Avatar name={row.name} src={row.photoUrl} size="md" />
            <span className="min-w-0 truncate">{row.name}</span>
          </span>
        ) : (
          "Student"
        )
      }
      description={row ? [row.admissionNo, cls ?? "Not enrolled"].join(" · ") : undefined}
      headerExtra={row ? <StatusPill status={row.status} /> : undefined}
      footer={
        row && (
          <>
            {perms.setup && (
              <Button type="button" variant="secondary" icon={<Pencil />} onClick={() => onAction({ kind: "edit", id: row.id, name: row.name })}>
                Edit
              </Button>
            )}
            <Link href={`/students/${row.id}`} className={buttonClass("primary", "md")}>
              <ExternalLink className="size-4" aria-hidden />
              Open full profile
            </Link>
          </>
        )
      }
    >
      {row && (
        <Tabs tabs={tabs} value={tab} onValueChange={setTab} aria-label={`${row.name} details`}>
          <TabPanel value="bio">
            {profileApi.error && !profile ? (
              <ErrorState message={profileApi.error} onRetry={profileApi.reload} compact />
            ) : !profile ? (
              <SkeletonRows rows={5} columns={2} />
            ) : (
              <BioTab profile={profile} />
            )}
          </TabPanel>
          <TabPanel value="contact">
            {profileApi.error && !profile ? (
              <ErrorState message={profileApi.error} onRetry={profileApi.reload} compact />
            ) : !profile ? (
              <SkeletonRows rows={3} columns={2} />
            ) : (
              <ContactTab profile={profile} />
            )}
          </TabPanel>
          <TabPanel value="performance">
            <PerfGate api={perfApi}>
              {perf && <PerformanceTab perf={perf} name={row.name} />}
            </PerfGate>
          </TabPanel>
          <TabPanel value="attendance">
            <PerfGate api={perfApi}>
              {perf && <AttendanceTab perf={perf} name={row.name} />}
            </PerfGate>
          </TabPanel>
          {perms.fees && (
            <TabPanel value="fees">
              <PerfGate api={perfApi}>
                {perf && <FeesTab perf={perf} row={row} onRecordPayment={onRecordPayment} />}
              </PerfGate>
            </TabPanel>
          )}
        </Tabs>
      )}
    </Drawer>
  );
}

function PerfGate({ api, children }: { api: { data: unknown; error: string; reload: () => void }; children: ReactNode }) {
  if (api.error && !api.data) return <ErrorState message={api.error} onRetry={api.reload} compact />;
  if (!api.data) return <SkeletonRows rows={4} columns={2} />;
  return <>{children}</>;
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-3 text-xs font-medium uppercase tracking-[0.04em] text-fg-muted">{children}</h3>;
}

function BioTab({ profile: s }: { profile: StudentProfile }) {
  const current = s.enrollments.find((e) => e.status === "ACTIVE") ?? s.enrollments[0];
  return (
    <div className="flex flex-col gap-6">
      <section>
        <SectionTitle>Personal</SectionTitle>
        <DescriptionList
          columns={2}
          items={[
            { label: "Gender", value: <span className="capitalize">{s.gender.toLowerCase()}</span> },
            { label: "Date of birth", value: s.dateOfBirth ? day(s.dateOfBirth) : "Not recorded" },
            { label: "B-Form", value: s.bFormNo ? <span className="tabular-nums">{formatCnic(s.bFormNo)}</span> : "Not recorded" },
            { label: "Campus", value: s.campus.name },
            { label: "Address", value: s.address ?? "Not recorded", full: true },
          ]}
        />
      </section>
      {s.medicalNotes && (
        <section className="rounded-lg border border-warning/30 bg-warning-tint px-4 py-3 text-sm text-warning-text">
          <div className="flex items-center gap-2 font-medium">
            <ShieldPlus className="size-4" aria-hidden />
            Medical notes
          </div>
          <p className="mt-1 whitespace-pre-line">{s.medicalNotes}</p>
        </section>
      )}
      <section>
        <SectionTitle>Enrolment</SectionTitle>
        <DescriptionList
          columns={2}
          items={[
            { label: "Admission no.", value: <span className="font-mono">{s.admissionNo}</span> },
            { label: "Admitted", value: day(s.admittedOn) },
            { label: "Class", value: current ? `${current.section.class.name} ${current.section.name}` : "Not enrolled" },
            { label: "Roll no.", value: current?.rollNo != null ? <span className="tabular-nums">{current.rollNo}</span> : "Not set" },
            { label: "Academic year", value: current?.academicYear.name ?? "None" },
            { label: "Student login", value: s.user ? (s.user.isActive ? "Active" : "Switched off") : "Not created" },
          ]}
        />
      </section>
      {s.enrollments.length > 1 && (
        <section>
          <SectionTitle>Class history</SectionTitle>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {s.enrollments.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="text-fg">
                  {e.section.class.name} {e.section.name}
                  <span className="text-fg-muted"> · {e.academicYear.name}</span>
                </span>
                <StatusPill status={e.status} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ContactTab({ profile: s }: { profile: StudentProfile }) {
  if (s.guardians.length === 0) {
    return <EmptyState icon={<Users />} title="No guardians added" description="Add a guardian from the full profile." compact />;
  }
  const guardians = [...s.guardians].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  return (
    <ul className="flex flex-col gap-3">
      {guardians.map((g) => (
        <li key={g.guardianId} className="rounded-xl border border-border p-4">
          <div className="flex items-start gap-3">
            <Avatar name={g.guardian.name} size="md" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-fg">
                {g.guardian.name}
                {g.isPrimary && <Badge tone="primary">Primary</Badge>}
                {g.guardian.userId && <Badge tone="success">Uses the app</Badge>}
              </div>
              <div className="mt-0.5 text-[13px] text-fg-muted">
                {g.relation}
                {g.guardian.cnic && <span className="tabular-nums"> · CNIC {formatCnic(g.guardian.cnic)}</span>}
              </div>
              <div className="mt-1 text-sm tabular-nums text-fg-secondary">{g.guardian.phone}</div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={`tel:${g.guardian.phone}`} className={buttonClass("secondary", "sm")} aria-label={`Call ${g.guardian.name} on ${g.guardian.phone}`}>
              <Phone className="size-4" aria-hidden />
              Call
            </a>
            <a
              href={`https://wa.me/${whatsappNumber(g.guardian.phone)}`}
              target="_blank"
              rel="noreferrer"
              className={buttonClass("secondary", "sm")}
              aria-label={`Message ${g.guardian.name} on WhatsApp`}
            >
              <MessageCircle className="size-4" aria-hidden />
              WhatsApp
            </a>
          </div>
        </li>
      ))}
    </ul>
  );
}

function PerformanceTab({ perf, name }: { perf: StudentPerformance; name: string }) {
  if (perf.subjects.length === 0) {
    return (
      <EmptyState
        icon={<ChartNoAxesColumn />}
        title="No marks yet"
        description="Subject scores appear here once marks are entered for an exam this year."
        compact
      />
    );
  }
  const source = perf.examName ? `${perf.examName} results` : "Average of marks entered this year";
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-fg">{source}</p>
          <p className="text-[13px] text-fg-muted">{perf.examName ? "Latest published exam." : "No exam results published yet."}</p>
        </div>
        {perf.overallPercent != null && (
          <div className="flex items-center gap-2">
            <span className="font-display text-xl font-semibold tabular-nums text-fg">{perf.overallPercent}%</span>
            {perf.grade && <LetterGrade grade={perf.grade} />}
          </div>
        )}
      </div>
      {perf.subjects.length >= 3 && (
        <div className="flex justify-center">
          <RadarChart
            label={`${name}: score by subject`}
            axes={perf.subjects.map((s) => s.subject)}
            series={[{ name: "Score", values: perf.subjects.map((s) => s.percent) }]}
            formatValue={(n) => `${n}%`}
            showLegend={false}
            size={300}
          />
        </div>
      )}
      <ul className="flex flex-col gap-3" aria-label="Score by subject">
        {perf.subjects.map((s) => (
          <li key={s.subject}>
            <ProgressBar label={s.subject} value={s.percent} showValue valueText={`${s.percent}%`} tone={s.percent >= 60 ? "primary" : s.percent >= 40 ? "warning" : "danger"} size="sm" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function AttendanceTab({ perf, name }: { perf: StudentPerformance; name: string }) {
  const c = perf.attendanceCounts;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] text-fg-muted">Attendance this academic year</p>
          <p className="font-display text-2xl font-semibold tabular-nums text-fg">
            {perf.attendanceRate == null ? <span className="text-base font-medium text-fg-muted">No data</span> : `${perf.attendanceRate}%`}
          </p>
        </div>
        {perf.attendanceRate != null && (
          <StatusPill
            status={rateTone(perf.attendanceRate)}
            tone={rateTone(perf.attendanceRate)}
            label={perf.attendanceRate >= 90 ? "On track" : perf.attendanceRate >= 75 ? "Needs watching" : "Below 75%"}
          />
        )}
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            ["Present", c.PRESENT],
            ["Late", c.LATE],
            ["Absent", c.ABSENT],
            ["Leave", c.LEAVE],
          ] as const
        ).map(([label, n]) => (
          <div key={label} className="rounded-lg bg-surface-2 px-3 py-2">
            <dt className="text-xs text-fg-muted">{label}</dt>
            <dd className="font-display text-lg font-semibold tabular-nums text-fg">{n}</dd>
          </div>
        ))}
      </dl>
      <section>
        <SectionTitle>Last 26 weeks</SectionTitle>
        {perf.attendanceByDay.length === 0 ? (
          <EmptyState icon={<CalendarCheck />} title="Nothing marked in the last 26 weeks" compact />
        ) : (
          <div className="overflow-x-auto pb-1">
            <CalendarHeatmap
              label={`${name}: attendance from ${day(perf.attendanceFrom)} to ${day(perf.attendanceTo)}`}
              from={perf.attendanceFrom}
              to={perf.attendanceTo}
              cellSize={12}
              days={perf.attendanceByDay.map((d) => ({
                date: d.date,
                tone: ATTENDANCE_TONE[d.status],
                title: `${day(d.date)}: ${STATUS_WORD[d.status]}`,
              }))}
              legend={ATTENDANCE_LEGEND}
            />
          </div>
        )}
      </section>
    </div>
  );
}

function FeesTab({ perf, row, onRecordPayment }: { perf: StudentPerformance; row: DirectoryRow; onRecordPayment: (id: string, name: string) => void }) {
  const f = perf.feeSummary;
  if (!f) {
    return <p className="text-sm text-fg-muted">Fee details are not available for your role.</p>;
  }
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[13px] text-fg-muted">Outstanding balance</p>
          <p className={`font-display text-2xl font-semibold tabular-nums ${f.balance > 0 ? "text-danger-text" : "text-fg"}`}>
            {f.balance > 0 ? rupees(f.balance) : "Nothing due"}
          </p>
        </div>
        <StatusPill status={f.status} />
      </div>
      <DescriptionList
        columns={2}
        items={[
          { label: "Total billed", value: <span className="tabular-nums">{rupees(f.totalBilled)}</span> },
          { label: "Total paid", value: <span className="tabular-nums">{rupees(f.totalPaid)}</span> },
          {
            label: "Overdue",
            value: <span className={`tabular-nums ${f.overdueBalance > 0 ? "font-medium text-danger-text" : ""}`}>{rupees(f.overdueBalance)}</span>,
          },
          { label: "Open invoices", value: <span className="tabular-nums">{f.openInvoices}</span> },
          {
            label: "Last payment",
            value: f.lastPayment ? (
              <span>
                <span className="tabular-nums">{rupees(f.lastPayment.amount)}</span> on {day(f.lastPayment.receivedAt)}
                <span className="text-fg-muted"> · receipt {f.lastPayment.receiptNo}</span>
              </span>
            ) : (
              "No payments yet"
            ),
            full: true,
          },
        ]}
      />
      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        {f.openInvoices > 0 && (
          <Button type="button" size="sm" icon={<Wallet />} onClick={() => onRecordPayment(row.id, row.name)}>
            Record payment
          </Button>
        )}
        <Link href={`/students/${row.id}`} className={buttonClass("secondary", "sm")}>
          See all invoices
        </Link>
      </div>
    </div>
  );
}
