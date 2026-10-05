"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import {
  BadgeCheck,
  Calculator,
  CalendarCheck,
  CalendarOff,
  Check,
  CheckCheck,
  FileText,
  Lock,
  Pencil,
  Plus,
  ReceiptText,
  Save,
  Send,
  Trash2,
  Users,
  Wallet,
  X,
} from "lucide-react";
import {
  Alert,
  Avatar,
  Button,
  buttonClass,
  Card,
  CardHeader,
  ConfirmDialog,
  DataTable,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  KpiCard,
  NativeSelect,
  PageHeader,
  ProgressBar,
  Section,
  SelectField,
  SkeletonRows,
  StatGrid,
  StatusPill,
  TabPanel,
  Tabs,
  TextArea,
  useToast,
  type Column,
} from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { day, rupees, thisMonth, todayIso } from "@/lib/format";
import { FEES, hasRole, SETUP, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

type Tab = "staff" | "attendance" | "leave" | "payroll" | "payslips";

export default function HrPage() {
  const user = useSession();
  const isAdmin = hasRole(user, SETUP);
  const isPayroll = hasRole(user, FEES);
  const staff = useApi<StaffMember[]>(isPayroll ? "/hr/staff" : null);
  const leave = useApi<Leave[]>("/hr/leave");
  const runs = useApi<RunSummary[]>(isPayroll ? "/hr/payroll" : null);
  const pendingLeave = leave.data?.filter((l) => l.status === "PENDING").length;

  const tabs = [
    ...(isPayroll ? [{ value: "staff", label: "Staff", icon: <Users />, count: staff.data?.length }] : []),
    ...(isAdmin ? [{ value: "attendance", label: "Staff attendance", icon: <CalendarCheck /> }] : []),
    { value: "leave", label: "Leave", icon: <CalendarOff />, count: isAdmin && pendingLeave ? pendingLeave : undefined },
    ...(isPayroll ? [{ value: "payroll", label: "Payroll", icon: <Wallet /> }] : []),
    { value: "payslips", label: "My payslips", icon: <ReceiptText /> },
  ];
  const [tab, setTab] = useState<Tab>(tabs[0].value as Tab);

  const working = staff.data?.filter((s) => s.staffProfile?.status !== "LEFT") ?? [];
  const salaryBill = working.reduce((sum, s) => sum + (s.staffProfile ? monthlyNet(s.staffProfile) : 0), 0);
  const latest = runs.data?.[0];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="HR and payroll"
        description="Staff records, daily staff register, leave requests and monthly salaries."
        breadcrumbs={[{ label: "Staff" }, { label: "HR and payroll" }]}
      />

      {isPayroll && (
        <StatGrid>
          <KpiCard label="Working staff" value={working.length} icon={<Users />} loading={!staff.data && !staff.error} hint={staff.data ? `${staff.data.length} on record` : undefined} />
          <KpiCard label="Monthly salary bill" value={rupees(salaryBill)} icon={<Wallet />} tone="info" loading={!staff.data && !staff.error} hint="Net, before unpaid days" />
          <KpiCard
            label={isAdmin ? "Leave awaiting decision" : "My pending leave"}
            value={pendingLeave ?? 0}
            icon={<CalendarOff />}
            tone={pendingLeave ? "warning" : "neutral"}
            loading={!leave.data && !leave.error}
          />
          <KpiCard
            label="Latest payroll"
            value={latest ? latest.period : "None yet"}
            icon={<BadgeCheck />}
            tone={latest?.status === "FINALIZED" ? "success" : "warning"}
            loading={!runs.data && !runs.error}
            hint={latest ? `${latest.paid} of ${latest.staff} paid, ${latest.status === "FINALIZED" ? "finalised" : "draft"}` : undefined}
          />
        </StatGrid>
      )}

      <Tabs tabs={tabs} value={tab} onValueChange={(v) => setTab(v as Tab)} aria-label="HR sections">
        {isPayroll && (
          <TabPanel value="staff">
            <StaffTab editable={isAdmin} staff={staff} />
          </TabPanel>
        )}
        {isAdmin && (
          <TabPanel value="attendance">
            <AttendanceTab />
          </TabPanel>
        )}
        <TabPanel value="leave">
          <LeaveTab isAdmin={isAdmin} leave={leave} />
        </TabPanel>
        {isPayroll && (
          <TabPanel value="payroll">
            <PayrollTab runs={runs} />
          </TabPanel>
        )}
        <TabPanel value="payslips">
          <MyPayslips />
        </TabPanel>
      </Tabs>
    </div>
  );
}

type Loaded<T> = { data: T | null; error: string; reload: () => Promise<void> };

// ---- Staff -----------------------------------------------------------------

interface PayItem { name: string; type: "ALLOWANCE" | "DEDUCTION"; amount: number }
interface Profile {
  employeeNo: string;
  designation: string;
  department: string | null;
  joinedOn: string | null;
  cnic: string | null;
  basicSalary: number;
  bankName: string | null;
  bankAccount: string | null;
  status: "ACTIVE" | "LEFT";
  payItems: PayItem[];
}
interface StaffMember {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  roles: { role: string }[];
  staffProfile: Profile | null;
}

const monthlyNet = (p: Profile) =>
  p.basicSalary + p.payItems.reduce((s, i) => s + (i.type === "ALLOWANCE" ? i.amount : -i.amount), 0);
const roleText = (s: StaffMember) => [...new Set(s.roles.map((r) => r.role.toLowerCase().replace("_", " ")))].join(", ");

function StaffTab({ editable, staff }: { editable: boolean; staff: Loaded<StaffMember[]> }) {
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [open, setOpen] = useState(false);
  const toast = useToast();

  const columns: Column<StaffMember>[] = [
    {
      id: "name",
      header: "Name",
      sortValue: (s) => s.name,
      cell: (s) => (
        <span className="flex items-center gap-2.5">
          <Avatar name={s.name} size="xs" />
          <span className="min-w-0">
            <span className="block font-medium">{s.name}</span>
            <span className="block text-xs capitalize text-fg-muted">{roleText(s)}</span>
          </span>
        </span>
      ),
    },
    { id: "emp", header: "Emp. no.", sortValue: (s) => s.staffProfile?.employeeNo, cell: (s) => s.staffProfile?.employeeNo ?? <span className="text-fg-muted">–</span>, hideBelow: "md" },
    {
      id: "designation",
      header: "Designation",
      sortValue: (s) => s.staffProfile?.designation,
      cell: (s) =>
        s.staffProfile ? (
          <span className="flex flex-wrap items-center gap-2">
            {s.staffProfile.designation}
            {s.staffProfile.status === "LEFT" && <StatusPill status="INACTIVE" label="Left" />}
          </span>
        ) : (
          <span className="text-fg-muted">Not set</span>
        ),
    },
    { id: "basic", header: "Basic", align: "right", sortValue: (s) => s.staffProfile?.basicSalary, cell: (s) => (s.staffProfile ? rupees(s.staffProfile.basicSalary) : "–"), hideBelow: "sm" },
    { id: "net", header: "Monthly net", align: "right", sortValue: (s) => (s.staffProfile ? monthlyNet(s.staffProfile) : null), cell: (s) => (s.staffProfile ? <span className="font-medium">{rupees(monthlyNet(s.staffProfile))}</span> : "–") },
    ...(editable
      ? [
          {
            id: "actions",
            header: <span className="sr-only">Actions</span>,
            width: "120px",
            align: "right" as const,
            cell: (s: StaffMember) => (
              <Button
                type="button"
                size="sm"
                variant={s.staffProfile ? "ghost" : "secondary"}
                icon={s.staffProfile ? <Pencil /> : <Plus />}
                aria-label={`${s.staffProfile ? "Edit details for" : "Add details for"} ${s.name}`}
                onClick={() => {
                  setEditing(s);
                  setOpen(true);
                }}
              >
                {s.staffProfile ? "Edit" : "Add details"}
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-3">
      <DataTable
        label="Staff"
        columns={columns}
        data={staff.data}
        error={staff.error}
        onRetry={staff.reload}
        getRowId={(s) => s.id}
        getSearchText={(s) => `${s.name} ${s.staffProfile?.employeeNo ?? ""} ${s.staffProfile?.designation ?? ""} ${s.staffProfile?.department ?? ""}`}
        searchPlaceholder="Search name, employee no. or designation"
        defaultSort={{ id: "name", dir: "asc" }}
        empty={{ title: "No staff yet", description: "Staff appear here once they have a login under Users and roles.", icon: <Users /> }}
        onRowClick={
          editable
            ? (s) => {
                setEditing(s);
                setOpen(true);
              }
            : undefined
        }
        getRowLabel={(s) => `Edit ${s.name}`}
      />
      <p className="text-xs text-fg-muted">Staff logins are added under Users and roles; salary details are kept here.</p>
      {editing && (
        <ProfileForm
          key={editing.id}
          member={editing}
          open={open}
          onOpenChange={setOpen}
          onSaved={async () => {
            setOpen(false);
            toast.success("Staff details saved", editing.name);
            await staff.reload();
          }}
        />
      )}
    </div>
  );
}

function ProfileForm({ member, open, onOpenChange, onSaved }: { member: StaffMember; open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => Promise<void> }) {
  const p = member.staffProfile;
  const [items, setItems] = useState<PayItem[]>(p?.payItems ?? []);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const formId = `staff-profile-${member.id}`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const text = (k: string) => (f.get(k) as string) || undefined;
    setSaving(true);
    try {
      await api(`/hr/staff/${member.id}`, {
        method: "PUT",
        body: {
          employeeNo: text("employeeNo"),
          designation: f.get("designation"),
          department: text("department"),
          joinedOn: text("joinedOn"),
          cnic: text("cnic"),
          basicSalary: Number(f.get("basicSalary")),
          bankName: text("bankName"),
          bankAccount: text("bankAccount"),
          status: f.get("status"),
          payItems: items.filter((i) => i.name).map((i) => ({ ...i, amount: Number(i.amount) })),
        },
      });
      setError("");
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const allowances = items.filter((i) => i.type === "ALLOWANCE").reduce((s, i) => s + Number(i.amount || 0), 0);
  const deductions = items.filter((i) => i.type === "DEDUCTION").reduce((s, i) => s + Number(i.amount || 0), 0);

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={member.name}
      description={p ? "Update employment and salary details." : "Add employment and salary details."}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form={formId} icon={<Save />} loading={saving}>Save details</Button>
        </>
      }
    >
      <form id={formId} className="flex flex-col gap-5" onSubmit={submit}>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Employee no." name="employeeNo" defaultValue={p?.employeeNo} placeholder="Automatic" />
          <Field label="Designation" name="designation" defaultValue={p?.designation} required />
          <Field label="Department" name="department" defaultValue={p?.department ?? ""} />
          <Field label="Joined" name="joinedOn" type="date" defaultValue={p?.joinedOn?.slice(0, 10)} />
          <Field label="CNIC" name="cnic" defaultValue={p?.cnic ?? ""} placeholder="35202-1234567-1" />
          <Field label="Basic salary (Rs)" name="basicSalary" type="number" min={0} defaultValue={p?.basicSalary ?? 0} required className="tabular-nums" />
          <Field label="Bank" name="bankName" defaultValue={p?.bankName ?? ""} />
          <Field label="Account / IBAN" name="bankAccount" defaultValue={p?.bankAccount ?? ""} />
          <SelectField
            label="Status"
            name="status"
            defaultValue={p?.status ?? "ACTIVE"}
            options={[{ value: "ACTIVE", label: "Working" }, { value: "LEFT", label: "Left the school" }]}
          />
        </div>
        <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-4">
          <legend className="px-1 text-[13px] font-medium text-fg-secondary">Monthly allowances and deductions</legend>
          {items.length === 0 && <p className="text-[13px] text-fg-muted">No allowances or deductions. Add house rent, conveyance, provident fund and so on.</p>}
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input className="h-9 min-w-0 flex-1" value={it.name} placeholder="House rent" aria-label={`Item ${i + 1} name`} onChange={(e) => setItems(items.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
              <NativeSelect
                wrapperClassName="w-32 shrink-0"
                value={it.type}
                aria-label={`Item ${i + 1} type`}
                onChange={(e) => setItems(items.map((x, k) => (k === i ? { ...x, type: e.target.value as PayItem["type"] } : x)))}
                options={[{ value: "ALLOWANCE", label: "Allowance" }, { value: "DEDUCTION", label: "Deduction" }]}
              />
              <Input className="h-9 w-24 shrink-0 text-right tabular-nums" type="number" min={0} value={it.amount} aria-label={`Item ${i + 1} amount`} onChange={(e) => setItems(items.map((x, k) => (k === i ? { ...x, amount: Number(e.target.value) } : x)))} />
              <IconButton aria-label={`Remove ${it.name || `item ${i + 1}`}`} variant="ghost" onClick={() => setItems(items.filter((_, k) => k !== i))}>
                <Trash2 />
              </IconButton>
            </div>
          ))}
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <Button type="button" size="sm" variant="secondary" icon={<Plus />} onClick={() => setItems([...items, { name: "", type: "ALLOWANCE", amount: 0 }])}>
              Add item
            </Button>
            {items.length > 0 && (
              <span className="text-xs tabular-nums text-fg-muted">
                Allowances <span className="font-medium text-success-text">+{rupees(allowances)}</span>, deductions <span className="font-medium text-danger-text">-{rupees(deductions)}</span>
              </span>
            )}
          </div>
        </fieldset>
      </form>
    </Drawer>
  );
}

// ---- Staff attendance ------------------------------------------------------

type Status = "PRESENT" | "ABSENT" | "LATE" | "LEAVE";
interface Register { taken: boolean; staff: { id: string; name: string; designation: string | null; status: Status | null }[] }
const BUTTONS: { status: Status; short: string; label: string; on: string }[] = [
  { status: "PRESENT", short: "P", label: "Present", on: "bg-success text-white" },
  { status: "ABSENT", short: "A", label: "Absent", on: "bg-danger text-white" },
  { status: "LATE", short: "L", label: "Late", on: "bg-warning text-white" },
  { status: "LEAVE", short: "Lv", label: "Leave", on: "bg-info text-white" },
];

function AttendanceTab() {
  const toast = useToast();
  const [date, setDate] = useState(todayIso());
  const [register, setRegister] = useState<Register | null>(null);
  const [marks, setMarks] = useState<Record<string, Status>>({});
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api<Register>(`/hr/attendance?date=${date}`)
      .then((r) => {
        if (cancelled) return;
        setRegister(r);
        setMarks(Object.fromEntries(r.staff.map((s) => [s.id, s.status ?? "PRESENT"])));
        setLoadError("");
      })
      .catch((e: Error) => !cancelled && setLoadError(e.message));
    return () => {
      cancelled = true;
    };
  }, [date, attempt]);

  async function save() {
    setSaving(true);
    try {
      const res = await api<{ saved: number }>("/hr/attendance", {
        method: "PUT",
        body: { date, records: Object.entries(marks).map(([userId, status]) => ({ userId, status })) },
      });
      toast.success("Register saved", `Saved the register for ${res.saved} staff.`);
      setRegister((r) => (r ? { ...r, taken: true } : r));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const counts = BUTTONS.map((b) => ({ ...b, n: Object.values(marks).filter((m) => m === b.status).length }));

  return (
    <Card>
      <CardHeader
        title="Staff register"
        description={register?.taken ? "Already taken for this day. Changes overwrite it." : "Not taken yet. Everyone starts as present; tap to change, then save."}
        icon={<CalendarCheck />}
        action={
          <>
            <Field
              label="Date"
              type="date"
              value={date}
              max={todayIso()}
              onChange={(e) => {
                setDate(e.target.value);
                setRegister(null);
              }}
            />
          </>
        }
      />
      {register && !register.taken && register.staff.length > 0 && (
        // Everyone defaults to present, so the counts would read as a register that was never taken.
        <Alert tone="warning" className="mb-3" title={date === todayIso() ? "Not taken yet today" : "No register for this day"}>
          Nothing is recorded for {date === todayIso() ? "today" : day(date)} yet. Mark the {register.staff.length} staff below and save to take the register.
        </Alert>
      )}
      {register && register.staff.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {register.taken && <StatusPill status="COMPLETED" label="Taken" />}
          {register.taken &&
            counts.map((c) => (
              <span key={c.status} className="text-xs text-fg-muted tabular-nums">
                {c.label} <span className="font-semibold text-fg">{c.n}</span>
              </span>
            ))}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            icon={<CheckCheck />}
            className="ms-auto"
            onClick={() => setMarks(Object.fromEntries(register.staff.map((s) => [s.id, "PRESENT" as Status])))}
          >
            Mark all present
          </Button>
        </div>
      )}
      {loadError ? (
        <ErrorState compact message={loadError} onRetry={() => setAttempt((a) => a + 1)} />
      ) : !register ? (
        <SkeletonRows rows={5} columns={2} />
      ) : register.staff.length === 0 ? (
        <EmptyState compact icon={<Users />} title="No staff to mark" description="Add staff logins under Users and roles first." />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {register.staff.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar name={s.name} size="sm" />
                <div className="min-w-0">
                  <div className="truncate font-medium text-fg">{s.name}</div>
                  {s.designation && <div className="truncate text-xs text-fg-muted">{s.designation}</div>}
                </div>
              </div>
              <div className="flex shrink-0 gap-1" role="group" aria-label={`Attendance for ${s.name}`}>
                {BUTTONS.map((b) => (
                  <button
                    key={b.status}
                    type="button"
                    onClick={() => setMarks((m) => ({ ...m, [s.id]: b.status }))}
                    aria-pressed={marks[s.id] === b.status}
                    aria-label={`${b.label}: ${s.name}`}
                    title={b.label}
                    className={cn(
                      "h-9 w-10 rounded-lg text-sm font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
                      marks[s.id] === b.status ? b.on : "bg-surface-3 text-fg-secondary hover:bg-border",
                    )}
                  >
                    {b.short}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <Alert tone="danger" className="mt-3">{error}</Alert>}
      <div className="mt-4 flex justify-end border-t border-border pt-4">
        <Button type="button" icon={<Save />} onClick={save} loading={saving} disabled={!register?.staff.length}>Save register</Button>
      </div>
    </Card>
  );
}

// ---- Leave -----------------------------------------------------------------

interface Leave {
  id: string;
  userId: string;
  type: string;
  fromDate: string;
  toDate: string;
  days: number;
  reason: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  user: { name: string };
}

function LeaveTab({ isAdmin, leave }: { isAdmin: boolean; leave: Loaded<Leave[]> }) {
  const user = useSession();
  const toast = useToast();
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const f = new FormData(form);
    setSending(true);
    try {
      await api("/hr/leave", {
        method: "POST",
        body: { type: f.get("type"), fromDate: f.get("fromDate"), toDate: f.get("toDate"), reason: f.get("reason") || undefined },
      });
      form.reset();
      setError("");
      toast.success("Leave request sent.");
      await leave.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function decide(l: Leave, approve: boolean) {
    setDeciding(l.id);
    try {
      await api(`/hr/leave/${l.id}/decide`, { method: "POST", body: { approve } });
      toast.success(approve ? "Leave approved" : "Leave rejected", l.user.name);
      await leave.reload();
    } catch (e) {
      toast.error("Could not save the decision", (e as Error).message);
    } finally {
      setDeciding(null);
    }
  }

  const canDecide = (l: Leave) => isAdmin && l.status === "PENDING" && (l.userId !== user.sub || hasRole(user, ["OWNER"]));
  const rows = leave.data?.filter((l) => !status || l.status === status) ?? null;

  const columns: Column<Leave>[] = [
    ...(isAdmin
      ? [{
          id: "who",
          header: "Staff",
          sortValue: (l: Leave) => l.user.name,
          cell: (l: Leave) => (
            <span className="flex items-center gap-2.5">
              <Avatar name={l.user.name} size="xs" />
              <span className="font-medium">{l.user.name}</span>
            </span>
          ),
        }]
      : []),
    {
      id: "type",
      header: "Leave",
      sortValue: (l) => l.fromDate,
      cell: (l) => (
        <span className="block">
          <span className="block capitalize">{l.type.toLowerCase()} leave</span>
          <span className="block text-xs text-fg-muted">
            {day(l.fromDate)}{l.toDate !== l.fromDate ? ` to ${day(l.toDate)}` : ""}
          </span>
          {l.reason && <span className="block max-w-[32ch] truncate text-xs text-fg-muted" title={l.reason}>{l.reason}</span>}
        </span>
      ),
    },
    { id: "days", header: "Days", align: "right", sortValue: (l) => l.days, cell: (l) => `${l.days} working day${l.days === 1 ? "" : "s"}`, hideBelow: "sm" },
    { id: "status", header: "Status", sortValue: (l) => l.status, cell: (l) => <StatusPill status={l.status} /> },
    ...(isAdmin
      ? [{
          id: "actions",
          header: <span className="sr-only">Actions</span>,
          align: "right" as const,
          cell: (l: Leave) =>
            canDecide(l) ? (
              <span className="inline-flex gap-1.5">
                <Button type="button" size="sm" variant="secondary" icon={<Check />} loading={deciding === l.id} onClick={() => decide(l, true)} aria-label={`Approve leave for ${l.user.name}`}>
                  Approve
                </Button>
                <Button type="button" size="sm" variant="ghost" icon={<X />} disabled={deciding === l.id} onClick={() => decide(l, false)} aria-label={`Reject leave for ${l.user.name}`}>
                  Reject
                </Button>
              </span>
            ) : null,
        }]
      : []),
  ];

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[2fr_1fr]">
      <Section title={isAdmin ? "Leave requests" : "My leave"}>
        <DataTable
          label={isAdmin ? "Leave requests" : "My leave"}
          columns={columns}
          data={rows}
          error={leave.error}
          onRetry={leave.reload}
          getRowId={(l) => l.id}
          getSearchText={isAdmin ? (l) => `${l.user.name} ${l.type} ${l.reason ?? ""}` : undefined}
          searchPlaceholder="Search staff or reason"
          filters={
            <NativeSelect
              aria-label="Status"
              placeholder="All statuses"
              wrapperClassName="w-40"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              options={[{ value: "PENDING", label: "Pending" }, { value: "APPROVED", label: "Approved" }, { value: "REJECTED", label: "Rejected" }]}
            />
          }
          filtered={!!status}
          pageSize={10}
          empty={{ title: "No leave requests yet", description: isAdmin ? "Requests from staff appear here for a decision." : "Apply using the form and track it here.", icon: <CalendarOff /> }}
        />
      </Section>
      <Card>
        <CardHeader title="Apply for leave" icon={<Send />} description="Working days are counted for you." />
        <form className="flex flex-col gap-4" onSubmit={apply}>
          <SelectField
            label="Type"
            name="type"
            options={[
              { value: "CASUAL", label: "Casual" },
              { value: "SICK", label: "Sick" },
              { value: "ANNUAL", label: "Annual" },
              { value: "UNPAID", label: "Unpaid" },
            ]}
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <Field label="From" name="fromDate" type="date" required defaultValue={todayIso()} />
            <Field label="To" name="toDate" type="date" required defaultValue={todayIso()} />
          </div>
          <TextArea label="Reason (optional)" name="reason" rows={2} />
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex justify-end">
            <Button type="submit" icon={<Send />} loading={sending}>Send request</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

// ---- Payroll ---------------------------------------------------------------

interface RunSummary { id: string; period: string; status: "DRAFT" | "FINALIZED"; staff: number; totalNet: number; paid: number }
interface Payslip {
  id: string;
  basic: number;
  allowances: number;
  deductions: number;
  unpaidDays: number;
  unpaidDeduction: number;
  net: number;
  paidAt: string | null;
  paymentMethod: string | null;
  user: { name: string; staffProfile: { employeeNo: string; designation: string; bankAccount: string | null } | null };
}
interface Run { id: string; period: string; status: "DRAFT" | "FINALIZED"; workingDays: number; totalNet: number; payslips: Payslip[] }

const runPill = (status: Run["status"]) =>
  status === "FINALIZED" ? <StatusPill status="COMPLETED" label="Finalised" /> : <StatusPill status="PENDING" label="Draft" />;

function PayrollTab({ runs }: { runs: Loaded<RunSummary[]> }) {
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = useApi<Run>(openId ? `/hr/payroll/${openId}` : null);
  const [period, setPeriod] = useState(thisMonth());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      setError("");
      await Promise.all([runs.reload(), open.reload()]);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const generate = () =>
    act(async () => {
      const run = await api<Run>("/hr/payroll", { method: "POST", body: { period } });
      setOpenId(run.id);
      toast.success(`Payroll for ${run.period} calculated`);
    });

  const run = open.data && open.data.id === openId ? open.data : null;

  const runColumns: Column<RunSummary>[] = [
    { id: "period", header: "Month", sortValue: (r) => r.period, cell: (r) => <span className="font-medium">{r.period}</span> },
    { id: "staff", header: "Staff", align: "right", sortValue: (r) => r.staff, cell: (r) => r.staff, hideBelow: "sm" },
    { id: "net", header: "Net total", align: "right", sortValue: (r) => r.totalNet, cell: (r) => rupees(r.totalNet) },
    {
      id: "paid",
      header: "Paid",
      sortValue: (r) => (r.staff ? r.paid / r.staff : 0),
      cell: (r) => <ProgressBar className="w-36" size="sm" value={r.paid} max={r.staff || 1} valueText={`${r.paid} of ${r.staff}`} tone={r.paid === r.staff && r.staff > 0 ? "success" : "primary"} />,
      hideBelow: "md",
    },
    { id: "status", header: "Status", sortValue: (r) => r.status, cell: (r) => runPill(r.status) },
  ];

  const slipColumns: Column<Payslip>[] = [
    {
      id: "name",
      header: "Staff",
      sortValue: (p) => p.user.name,
      cell: (p) => (
        <span className="block">
          <span className="block font-medium">{p.user.name}</span>
          <span className="block text-xs text-fg-muted">{[p.user.staffProfile?.employeeNo, p.user.staffProfile?.designation].filter(Boolean).join(", ")}</span>
        </span>
      ),
    },
    { id: "basic", header: "Basic", align: "right", sortValue: (p) => p.basic, cell: (p) => rupees(p.basic), hideBelow: "md" },
    { id: "allow", header: "Allowances", align: "right", sortValue: (p) => p.allowances, cell: (p) => rupees(p.allowances), hideBelow: "lg" },
    { id: "deduct", header: "Deductions", align: "right", sortValue: (p) => p.deductions + p.unpaidDeduction, cell: (p) => rupees(p.deductions + p.unpaidDeduction), hideBelow: "lg" },
    { id: "unpaid", header: "Unpaid days", align: "right", sortValue: (p) => p.unpaidDays, cell: (p) => (p.unpaidDays ? <span className="text-danger-text">{p.unpaidDays}</span> : "–"), hideBelow: "sm" },
    { id: "net", header: "Net", align: "right", sortValue: (p) => p.net, cell: (p) => <span className="font-semibold">{rupees(p.net)}</span> },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (p) => (
        <span className="inline-flex items-center justify-end gap-2 whitespace-nowrap">
          <Link href={`/hr/payslips/${p.id}`} className={buttonClass("ghost", "sm")} aria-label={`Payslip for ${p.user.name}`}>
            <FileText aria-hidden />
            Payslip
          </Link>
          {run?.status === "FINALIZED" &&
            (p.paidAt ? (
              <StatusPill status="PAID" label={`Paid${p.paymentMethod ? `, ${p.paymentMethod.toLowerCase()}` : ""}`} />
            ) : (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy}
                aria-label={`Mark ${p.user.name} paid`}
                onClick={() => act(() => api(`/hr/payroll/${run.id}/payslips/${p.id}/pay`, { method: "POST", body: { method: "BANK" } }))}
              >
                Mark paid
              </Button>
            ))}
        </span>
      ),
    },
  ];

  const totals = run?.payslips.reduce(
    (t, p) => ({ basic: t.basic + p.basic, allow: t.allow + p.allowances, deduct: t.deduct + p.deductions + p.unpaidDeduction }),
    { basic: 0, allow: 0, deduct: 0 },
  );

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title="Calculate payroll"
          icon={<Calculator />}
          description="Absent days and unpaid leave from the staff register are deducted at a day's basic salary. Recalculate a draft as often as you need; finalise it to lock it and start paying."
        />
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Month" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          <Button type="button" icon={<Calculator />} onClick={generate} loading={busy}>Calculate payroll</Button>
        </div>
        {error && <Alert tone="danger" className="mt-4" onDismiss={() => setError("")}>{error}</Alert>}
      </Card>

      <Section title="Payroll months" description="Pick a month to see its payslips.">
        <DataTable
          label="Payroll months"
          columns={runColumns}
          data={runs.data}
          error={runs.error}
          onRetry={runs.reload}
          getRowId={(r) => r.id}
          onRowClick={(r) => setOpenId(r.id)}
          getRowLabel={(r) => `Open payroll ${r.period}`}
          rowClassName={(r) => (r.id === openId ? "!bg-primary-tint" : undefined)}
          pageSize={12}
          empty={{ title: "No payroll yet", description: "Choose a month above and calculate it to create the first draft.", icon: <Wallet /> }}
        />
      </Section>

      {openId && (
        <Section
          title={run ? `Payroll ${run.period}` : "Payroll"}
          description={run ? `${run.workingDays} working days, net ${rupees(run.totalNet)}` : "Loading payslips"}
          action={
            run && (
              <>
                {runPill(run.status)}
                {run.status === "DRAFT" && (
                  <Button type="button" icon={<Lock />} onClick={() => setConfirming(true)} disabled={busy}>Finalise</Button>
                )}
              </>
            )
          }
        >
          <DataTable
            label={run ? `Payslips for ${run.period}` : "Payslips"}
            columns={slipColumns}
            data={run?.payslips ?? null}
            error={open.error}
            onRetry={open.reload}
            getRowId={(p) => p.id}
            getSearchText={(p) => `${p.user.name} ${p.user.staffProfile?.employeeNo ?? ""} ${p.user.staffProfile?.designation ?? ""}`}
            searchPlaceholder="Search staff"
            pageSize={0}
            empty={{ title: "No payslips", description: "Add salary details for staff on the Staff tab, then recalculate." }}
            footer={
              run && totals ? (
                <tr className="h-11 text-sm">
                  <td className="border-t border-border px-4 font-semibold">Total</td>
                  <td className="hidden border-t border-border px-4 text-right tabular-nums md:table-cell">{rupees(totals.basic)}</td>
                  <td className="hidden border-t border-border px-4 text-right tabular-nums lg:table-cell">{rupees(totals.allow)}</td>
                  <td className="hidden border-t border-border px-4 text-right tabular-nums lg:table-cell">{rupees(totals.deduct)}</td>
                  <td className="hidden border-t border-border px-4 sm:table-cell" />
                  <td className="border-t border-border px-4 text-right font-semibold tabular-nums">{rupees(run.totalNet)}</td>
                  <td className="border-t border-border px-4" />
                </tr>
              ) : undefined
            }
          />
        </Section>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Finalise payroll ${run?.period ?? ""}?`}
        description="Payslips can't be recalculated afterwards. You can then mark each one paid."
        confirmLabel="Finalise"
        loading={busy}
        onConfirm={async () => {
          if (!run) return;
          const ok = await act(() => api(`/hr/payroll/${run.id}/finalize`, { method: "POST" }));
          setConfirming(false);
          if (ok) toast.success(`Payroll ${run.period} finalised`);
        }}
      />
    </div>
  );
}

interface MySlip { id: string; net: number; paidAt: string | null; run: { period: string } }

function MyPayslips() {
  const slips = useApi<MySlip[]>("/hr/payslips/mine");
  const columns: Column<MySlip>[] = [
    {
      id: "period",
      header: "Month",
      sortValue: (s) => s.run.period,
      cell: (s) => (
        <Link href={`/hr/payslips/${s.id}`} className="inline-flex items-center gap-2 font-medium text-brand hover:underline">
          <FileText className="size-4" aria-hidden />
          {s.run.period}
        </Link>
      ),
    },
    { id: "net", header: "Net pay", align: "right", sortValue: (s) => s.net, cell: (s) => rupees(s.net) },
    { id: "status", header: "Status", cell: (s) => (s.paidAt ? <StatusPill status="PAID" label={`Paid ${day(s.paidAt)}`} /> : <StatusPill status="PENDING" label="Not paid yet" />) },
  ];
  return (
    <DataTable
      label="My payslips"
      columns={columns}
      data={slips.data}
      error={slips.error}
      onRetry={slips.reload}
      getRowId={(s) => s.id}
      defaultSort={{ id: "period", dir: "desc" }}
      pageSize={12}
      empty={{ title: "No payslips yet", description: "They appear here once a month's payroll is finalised.", icon: <ReceiptText /> }}
    />
  );
}
