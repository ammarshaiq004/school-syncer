"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import {
  BookOpen,
  Bus,
  CalendarCheck,
  FileBadge,
  GraduationCap,
  ArrowRightLeft,
  IdCard,
  LayoutGrid,
  MessageCircle,
  Phone,
  Plus,
  Send,
  Star,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";
import { StudentFees } from "@/components/fees/student-fees";
import { StudentLoginCard, type StudentLogin } from "@/components/student/student-login-card";
import { StudentLibrary } from "@/components/student-library";
import { DeleteDialog, RowActions } from "@/components/setup/row-actions";
import { GuardianDialog, type GuardianLink } from "@/components/students/guardian-dialogs";
import { MoveSectionDialog } from "@/components/students/move-section-dialog";
import { StudentPhoto } from "@/components/students/student-photo";
import { StudentTransport } from "@/components/student-transport";
import { attendanceRate, StudentAttendance, StudentExams } from "@/components/students/profile-sections";
import {
  Avatar,
  Badge,
  Breadcrumbs,
  Button,
  buttonClass,
  Card,
  CardHeader,
  DataTable,
  DescriptionList,
  DropdownItem,
  EmptyState,
  ErrorState,
  Skeleton,
  SkeletonRows,
  StatusPill,
  TabPanel,
  Tabs,
  useToast,
  type Column,
  type TabItem,
} from "@/components/ui";
import { api } from "@/lib/api";
import { day, fullName, rupees } from "@/lib/format";
import { formatCnic, formatPhone, whatsAppNumber } from "@/lib/identity";
import { FEES, hasRole, SETUP, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

interface Profile {
  id: string;
  admissionNo: string;
  firstName: string;
  lastName: string | null;
  gender: string;
  dateOfBirth: string | null;
  bFormNo: string | null;
  photoUrl: string | null;
  address: string | null;
  medicalNotes: string | null;
  status: string;
  admittedOn: string;
  campus: { name: string };
  guardians: GuardianLink[];
  enrollments: { id: string; rollNo: number | null; status: string; academicYear: { name: string }; section: { id: string; name: string; class: { name: string } } }[];
  /** Section moves during a year, newest first. */
  moves?: { at: string; from: string | null; to: string | null; reason: string | null; by: string | null }[];
  invoices: { id: string; period: string; total: number; paid: number; status: string; dueDate: string; kind: "MONTHLY" | "ADHOC" }[];
  attendanceSummary: Record<string, number>;
  /** The student's own login for the student workspace, if any. */
  user?: StudentLogin | null;
}

type Enrollment = Profile["enrollments"][number];

const enrollmentColumns: Column<Enrollment>[] = [
  { id: "year", header: "Year", cell: (e) => e.academicYear.name },
  { id: "class", header: "Class", cell: (e) => `${e.section.class.name} ${e.section.name}` },
  { id: "roll", header: "Roll", align: "right", cell: (e) => e.rollNo ?? "–" },
  { id: "status", header: "Status", cell: (e) => <StatusPill status={e.status} /> },
];

function ProfileSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <Skeleton className="h-4 w-40" />
      <Card>
        <div className="flex items-center gap-4">
          <Skeleton className="size-16 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
        </div>
      </Card>
      <SkeletonRows rows={5} />
    </div>
  );
}

export default function StudentProfilePage() {
  const { id } = useParams<{ id: string }>();
  const user = useSession();
  const toast = useToast();
  const student = useApi<Profile>(`/students/${id}`);
  const [inviting, setInviting] = useState("");
  const [guardianDialog, setGuardianDialog] = useState<{ link: GuardianLink | null } | null>(null);
  const [removing, setRemoving] = useState<GuardianLink | null>(null);
  const [moving, setMoving] = useState(false);
  const [tab, setTab] = useState("overview");
  const s = student.data;

  async function invite(guardianId: string) {
    setInviting(guardianId);
    try {
      const res = await api<{ usesExistingLogin: boolean }>(`/students/${id}/guardians/${guardianId}/invite`, { method: "POST" });
      toast.success(
        res.usesExistingLogin ? "Parent access added" : "Invite sent",
        res.usesExistingLogin ? "This guardian already had a login; parent access was added." : "Login details sent to the guardian on WhatsApp.",
      );
      await student.reload();
    } catch (e) {
      toast.error("Could not send the invite", (e as Error).message);
    } finally {
      setInviting("");
    }
  }

  if (!s) {
    return student.error ? (
      <div className="flex flex-col gap-6">
        <Breadcrumbs items={[{ label: "Students", href: "/students" }, { label: "Profile" }]} />
        <ErrorState title="Could not load this student" message={student.error} onRetry={student.reload} />
      </div>
    ) : (
      <ProfileSkeleton />
    );
  }

  const name = fullName(s);
  const current = s.enrollments.find((e) => e.status === "ACTIVE") ?? s.enrollments[0];
  const primary = s.guardians.find((g) => g.isPrimary) ?? s.guardians[0];
  const { rate } = attendanceRate(s.attendanceSummary);
  const canSetup = hasRole(user, SETUP);
  const canFees = hasRole(user, FEES);
  const certificates = user.plan?.features.includes("certificates") !== false;
  // Online schools have no van or library.
  const onCampus = user.school?.mode !== "ONLINE";
  const transport = onCampus && user.plan?.features.includes("transport") !== false;
  const library = onCampus && user.plan?.features.includes("library") !== false;
  // Only open vouchers owe money; a carried-forward balance is owed on the later voucher.
  const balance = s.invoices
    .filter((i) => i.status === "UNPAID" || i.status === "PARTIAL")
    .reduce((sum, i) => sum + Math.max(0, i.total - i.paid), 0);
  const waPhone = primary ? whatsAppNumber(primary.guardian.phone) : "";

  async function makePrimary(g: GuardianLink) {
    try {
      await api(`/students/${id}/guardians/${g.guardianId}`, { method: "PATCH", body: { isPrimary: true } });
      toast.success(`${g.guardian.name} is now the primary guardian`);
      await student.reload();
    } catch (e) {
      toast.error("Could not change the primary guardian", (e as Error).message);
    }
  }

  const tabs: TabItem[] = [
    { value: "overview", label: "Overview", icon: <LayoutGrid /> },
    { value: "attendance", label: "Attendance", icon: <CalendarCheck /> },
    ...(canFees ? [{ value: "fees", label: "Fees", icon: <Wallet />, count: s.invoices.length }] : []),
    { value: "exams", label: "Exams", icon: <GraduationCap /> },
    ...(library ? [{ value: "library", label: "Library", icon: <BookOpen /> }] : []),
    ...(transport ? [{ value: "transport", label: "Transport", icon: <Bus /> }] : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs items={[{ label: "Students", href: "/students" }, { label: name }]} className="print:hidden" />

      <Card padding="lg">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <StudentPhoto studentId={s.id} name={name} photoUrl={s.photoUrl} canManage={canSetup} onChanged={student.reload} />
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-fg sm:text-2xl">{name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-fg-muted">
                <StatusPill status={s.status} />
                <span className="font-mono">{s.admissionNo}</span>
                {current && (
                  <>
                    <span aria-hidden>·</span>
                    <span>
                      {current.section.class.name} {current.section.name}
                      {current.rollNo != null && `, roll ${current.rollNo}`}
                    </span>
                  </>
                )}
                <span aria-hidden>·</span>
                <span>{s.campus.name}</span>
              </div>
            </div>
          </div>
          {((certificates && (s.status === "ACTIVE" || canSetup)) || (canSetup && s.status === "ACTIVE" && current)) && (
            <div className="flex flex-wrap gap-2 print:hidden">
              {canSetup && s.status === "ACTIVE" && current?.status === "ACTIVE" && (
                <Button type="button" size="sm" variant="secondary" icon={<ArrowRightLeft />} onClick={() => setMoving(true)}>
                  Move section
                </Button>
              )}
              {certificates && s.status === "ACTIVE" && user.school?.mode !== "ONLINE" && (
                <Link className={buttonClass("secondary", "sm")} href={`/certificates/id-cards?studentIds=${s.id}`}>
                  <IdCard className="size-4" aria-hidden />
                  ID card
                </Link>
              )}
              {certificates && canSetup && (
                <Link className={buttonClass("secondary", "sm")} href={`/certificates/new?studentId=${s.id}`}>
                  <FileBadge className="size-4" aria-hidden />
                  Issue certificate
                </Link>
              )}
            </div>
          )}
        </div>

        <dl className="mt-6 grid gap-4 border-t border-border pt-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="min-w-0">
            <dt className="text-xs font-medium text-fg-muted">Primary guardian</dt>
            <dd className="mt-0.5 truncate text-sm text-fg">
              {primary ? `${primary.guardian.name} (${primary.relation})` : "Not added"}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-medium text-fg-muted">Guardian phone</dt>
            <dd className="mt-0.5 flex items-center gap-3 text-sm">
              {primary ? (
                <>
                  <a href={`tel:${primary.guardian.phone}`} className="inline-flex items-center gap-1.5 tabular-nums text-fg hover:text-brand">
                    <Phone className="size-3.5 text-fg-muted" aria-hidden />
                    {formatPhone(primary.guardian.phone)}
                  </a>
                  <a
                    href={`https://wa.me/${waPhone}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline print:hidden"
                    aria-label={`Message ${primary.guardian.name} on WhatsApp`}
                  >
                    <MessageCircle className="size-3.5" aria-hidden />
                    WhatsApp
                  </a>
                </>
              ) : (
                "–"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-fg-muted">Attendance</dt>
            <dd className="mt-0.5 text-sm tabular-nums text-fg">{rate === null ? "Not marked yet" : `${rate}% present`}</dd>
          </div>
          {canFees ? (
            <div>
              <dt className="text-xs font-medium text-fg-muted">Fee balance</dt>
              <dd className={`mt-0.5 text-sm tabular-nums ${balance > 0 ? "font-medium text-danger-text" : "text-fg"}`}>
                {balance > 0 ? rupees(balance) : "Nothing due"}
              </dd>
            </div>
          ) : (
            <div>
              <dt className="text-xs font-medium text-fg-muted">Admitted</dt>
              <dd className="mt-0.5 text-sm text-fg">{day(s.admittedOn)}</dd>
            </div>
          )}
        </dl>
      </Card>

      <Tabs tabs={tabs} value={tab} onValueChange={setTab} aria-label="Student profile sections">
        <TabPanel value="overview">
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Details" icon={<UserRound />} />
              <DescriptionList
                columns={2}
                items={[
                  { label: "Admission no.", value: <span className="font-mono">{s.admissionNo}</span> },
                  { label: "Campus", value: s.campus.name },
                  { label: "Gender", value: <span className="capitalize">{s.gender.toLowerCase()}</span> },
                  { label: "Date of birth", value: s.dateOfBirth ? day(s.dateOfBirth) : "–" },
                  { label: "B-Form", value: s.bFormNo ? <span className="tabular-nums">{formatCnic(s.bFormNo)}</span> : "–" },
                  { label: "Admitted", value: day(s.admittedOn) },
                  { label: "Address", value: s.address ?? "–", full: true },
                  ...(s.medicalNotes ? [{ label: "Medical notes", value: s.medicalNotes, full: true }] : []),
                ]}
              />
            </Card>
            <div className="flex flex-col gap-6">
              <Card>
                <CardHeader
                  title="Guardians"
                  icon={<Users />}
                  action={
                    canSetup && s.guardians.length < 4 ? (
                      <Button type="button" size="sm" variant="ghost" icon={<Plus />} onClick={() => setGuardianDialog({ link: null })}>
                        Add
                      </Button>
                    ) : undefined
                  }
                />
                {s.guardians.length === 0 ? (
                  <EmptyState icon={<Users />} title="No guardians added" compact />
                ) : (
                  <ul className="-my-3 flex flex-col divide-y divide-border">
                    {s.guardians.map((g) => (
                      <li key={g.guardianId} className="flex items-start justify-between gap-3 py-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <Avatar name={g.guardian.name} size="sm" />
                          <div className="min-w-0 text-sm">
                            <div className="flex flex-wrap items-center gap-1.5 font-medium text-fg">
                              {g.guardian.name}
                              {g.isPrimary && <Badge tone="primary">Primary</Badge>}
                            </div>
                            <div className="text-[13px] text-fg-muted">
                              {g.relation} · <a href={`tel:${g.guardian.phone}`} className="tabular-nums hover:text-brand">{formatPhone(g.guardian.phone)}</a>
                            </div>
                            {g.guardian.cnic && <div className="text-xs tabular-nums text-fg-muted">CNIC {formatCnic(g.guardian.cnic)}</div>}
                          </div>
                        </div>
                        {canSetup && (
                          <div className="flex shrink-0 items-center gap-1">
                            {g.guardian.userId ? (
                              <Badge tone="success">Has login</Badge>
                            ) : (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                icon={<Send />}
                                loading={inviting === g.guardianId}
                                onClick={() => invite(g.guardianId)}
                              >
                                Invite to app
                              </Button>
                            )}
                            <RowActions
                              label={g.guardian.name}
                              onEdit={() => setGuardianDialog({ link: g })}
                              onDelete={s.guardians.length > 1 ? () => setRemoving(g) : undefined}
                            >
                              {!g.isPrimary && (
                                <DropdownItem icon={<Star />} onSelect={() => makePrimary(g)}>
                                  Make primary
                                </DropdownItem>
                              )}
                            </RowActions>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <StudentLoginCard
                student={{ id: s.id, name, admissionNo: s.admissionNo, rollNo: current?.rollNo ?? null, status: s.status }}
                login={s.user}
                canManage={canSetup}
                onChanged={student.reload}
              />
            </div>
            <Card padding="none" className="lg:col-span-3">
              <div className="px-5 pt-5">
                <CardHeader title="Class history" icon={<GraduationCap />} />
              </div>
              <DataTable
                bare
                label="Class history"
                columns={enrollmentColumns}
                data={s.enrollments}
                getRowId={(e) => e.id}
                pageSize={0}
                empty={{ title: "Not enrolled in any class yet" }}
              />
              {s.moves && s.moves.length > 0 && (
                <ul className="flex flex-col gap-1 border-t border-border px-5 py-4 text-[13px] text-fg-muted">
                  {s.moves.map((m, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-1.5">
                      <ArrowRightLeft className="size-3.5" aria-hidden />
                      <span>
                        {day(m.at)}: moved from <span className="text-fg">{m.from ?? "?"}</span> to <span className="text-fg">{m.to ?? "?"}</span>
                        {m.by && ` by ${m.by}`}
                        {m.reason && ` (${m.reason})`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </TabPanel>

        <TabPanel value="attendance">
          <StudentAttendance studentId={s.id} summary={s.attendanceSummary} />
        </TabPanel>

        {canFees && (
          <TabPanel value="fees">
            <StudentFees studentId={s.id} invoices={s.invoices} onChanged={student.reload} />
          </TabPanel>
        )}

        <TabPanel value="exams">
          <StudentExams studentId={s.id} />
        </TabPanel>

        {library && (
          <TabPanel value="library">
            <StudentLibrary studentId={s.id} />
          </TabPanel>
        )}

        {transport && (
          <TabPanel value="transport">
            <StudentTransport studentId={s.id} active={s.status === "ACTIVE"} />
          </TabPanel>
        )}
      </Tabs>

      {canSetup && (
        <>
          <GuardianDialog
            key={guardianDialog?.link?.guardianId ?? "new"}
            studentId={s.id}
            link={guardianDialog?.link}
            open={guardianDialog !== null}
            onClose={() => setGuardianDialog(null)}
            onSaved={student.reload}
          />
          <DeleteDialog
            target={
              removing
                ? {
                    name: removing.guardian.name,
                    path: `/students/${s.id}/guardians/${removing.guardianId}`,
                    detail: `${removing.guardian.name} will no longer be ${name}'s guardian. Their other children are not affected.`,
                    action: "Remove",
                    done: `${removing.guardian.name} removed`,
                  }
                : null
            }
            onClose={() => setRemoving(null)}
            onDeleted={student.reload}
          />
          <MoveSectionDialog
            student={{ id: s.id, name, sectionId: current?.status === "ACTIVE" ? current.section.id : null }}
            open={moving}
            onClose={() => setMoving(false)}
            onMoved={student.reload}
          />
        </>
      )}
    </div>
  );
}
