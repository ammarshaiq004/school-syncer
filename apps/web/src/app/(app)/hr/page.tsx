"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Select } from "@/components/select";
import { Badge, Button, Card, ErrorText, Field, Notice, PageTitle, rowClass, tableClass, TextArea } from "@/components/ui";
import { api } from "@/lib/api";
import { day, rupees, thisMonth, todayIso } from "@/lib/format";
import { FEES, hasRole, SETUP, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

type Tab = "Staff" | "Staff attendance" | "Leave" | "Payroll" | "My payslips";

export default function HrPage() {
  const user = useSession();
  const isAdmin = hasRole(user, SETUP);
  const isPayroll = hasRole(user, FEES);
  const tabs: Tab[] = [
    ...(isPayroll ? (["Staff"] as const) : []),
    ...(isAdmin ? (["Staff attendance"] as const) : []),
    "Leave",
    ...(isPayroll ? (["Payroll"] as const) : []),
    "My payslips",
  ];
  const [tab, setTab] = useState<Tab>(tabs[0]);
  return (
    <div className="flex flex-col gap-6">
      <PageTitle>HR and payroll</PageTitle>
      <div className="flex gap-2 overflow-x-auto border-b border-black/10 dark:border-white/10">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm ${tab === t ? "border-brand font-medium text-brand" : "border-transparent opacity-70"}`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Staff" && <StaffTab editable={isAdmin} />}
      {tab === "Staff attendance" && <AttendanceTab />}
      {tab === "Leave" && <LeaveTab isAdmin={isAdmin} />}
      {tab === "Payroll" && <PayrollTab />}
      {tab === "My payslips" && <MyPayslips />}
    </div>
  );
}

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

function StaffTab({ editable }: { editable: boolean }) {
  const staff = useApi<StaffMember[]>("/hr/staff");
  const [editing, setEditing] = useState<StaffMember | null>(null);
  return (
    <div className={`grid gap-6 ${editing ? "lg:grid-cols-[3fr_2fr]" : ""}`}>
      <Card>
        <ErrorText>{staff.error}</ErrorText>
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <thead className="opacity-60">
              <tr><th className="py-2">Name</th><th>Emp. no.</th><th>Designation</th><th>Basic</th><th>Monthly net</th><th /></tr>
            </thead>
            <tbody>
              {staff.data?.map((s) => (
                <tr key={s.id} className={rowClass}>
                  <td className="py-2">
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs opacity-60">{[...new Set(s.roles.map((r) => r.role.toLowerCase().replace("_", " ")))].join(", ")}</div>
                  </td>
                  <td>{s.staffProfile?.employeeNo ?? "–"}</td>
                  <td>{s.staffProfile?.designation ?? <span className="opacity-50">not set</span>}{s.staffProfile?.status === "LEFT" && <> <Badge tone="gray">left</Badge></>}</td>
                  <td>{s.staffProfile ? rupees(s.staffProfile.basicSalary) : "–"}</td>
                  <td>{s.staffProfile ? rupees(monthlyNet(s.staffProfile)) : "–"}</td>
                  <td>{editable && <button className="text-sm text-brand" onClick={() => setEditing(s)}>{s.staffProfile ? "Edit" : "Add details"}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs opacity-60">Staff logins are added under Users and roles; salary details are kept here.</p>
      </Card>
      {editing && (
        <ProfileForm
          key={editing.id}
          member={editing}
          onDone={async () => {
            setEditing(null);
            await staff.reload();
          }}
        />
      )}
    </div>
  );
}

function ProfileForm({ member, onDone }: { member: StaffMember; onDone: () => Promise<void> }) {
  const p = member.staffProfile;
  const [items, setItems] = useState<PayItem[]>(p?.payItems ?? []);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const text = (k: string) => (f.get(k) as string) || undefined;
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
      await onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const input = "rounded-lg border border-black/15 bg-transparent px-2 py-1 text-sm dark:border-white/20";
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">{member.name}</h2>
        <button className="text-sm opacity-60" onClick={() => onDone()}>Close</button>
      </div>
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Employee no." name="employeeNo" defaultValue={p?.employeeNo} placeholder="Automatic" />
          <Field label="Designation" name="designation" defaultValue={p?.designation} required />
          <Field label="Department" name="department" defaultValue={p?.department ?? ""} />
          <Field label="Joined" name="joinedOn" type="date" defaultValue={p?.joinedOn?.slice(0, 10)} />
          <Field label="CNIC" name="cnic" defaultValue={p?.cnic ?? ""} placeholder="35202-1234567-1" />
          <Field label="Basic salary (Rs)" name="basicSalary" type="number" min={0} defaultValue={p?.basicSalary ?? 0} required />
          <Field label="Bank" name="bankName" defaultValue={p?.bankName ?? ""} />
          <Field label="Account / IBAN" name="bankAccount" defaultValue={p?.bankAccount ?? ""} />
        </div>
        <Select label="Status" name="status" defaultValue={p?.status ?? "ACTIVE"} options={[{ value: "ACTIVE", label: "Working" }, { value: "LEFT", label: "Left the school" }]} />
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 font-medium">Monthly allowances and deductions</legend>
          {items.map((it, i) => (
            <div key={i} className="flex gap-2">
              <input className={`${input} min-w-0 flex-1`} value={it.name} placeholder="House rent" aria-label="Item name" onChange={(e) => setItems(items.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
              <select className={input} value={it.type} aria-label="Item type" onChange={(e) => setItems(items.map((x, k) => (k === i ? { ...x, type: e.target.value as PayItem["type"] } : x)))}>
                <option value="ALLOWANCE">Allowance</option>
                <option value="DEDUCTION">Deduction</option>
              </select>
              <input className={`${input} w-24`} type="number" min={0} value={it.amount} aria-label="Amount" onChange={(e) => setItems(items.map((x, k) => (k === i ? { ...x, amount: Number(e.target.value) } : x)))} />
              <button type="button" className="text-red-600" onClick={() => setItems(items.filter((_, k) => k !== i))}>×</button>
            </div>
          ))}
          <button type="button" className="self-start text-brand" onClick={() => setItems([...items, { name: "", type: "ALLOWANCE", amount: 0 }])}>Add item</button>
        </fieldset>
        <Button type="submit">Save details</Button>
        <ErrorText>{error}</ErrorText>
      </form>
    </Card>
  );
}

// ---- Staff attendance ------------------------------------------------------

type Status = "PRESENT" | "ABSENT" | "LATE" | "LEAVE";
interface Register { taken: boolean; staff: { id: string; name: string; designation: string | null; status: Status | null }[] }
const BUTTONS: { status: Status; short: string; on: string }[] = [
  { status: "PRESENT", short: "P", on: "bg-green-600 text-white" },
  { status: "ABSENT", short: "A", on: "bg-red-600 text-white" },
  { status: "LATE", short: "L", on: "bg-amber-500 text-white" },
  { status: "LEAVE", short: "Lv", on: "bg-slate-500 text-white" },
];

function AttendanceTab() {
  const [date, setDate] = useState(todayIso());
  const [register, setRegister] = useState<Register | null>(null);
  const [marks, setMarks] = useState<Record<string, Status>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    api<Register>(`/hr/attendance?date=${date}`)
      .then((r) => {
        if (cancelled) return;
        setRegister(r);
        setMarks(Object.fromEntries(r.staff.map((s) => [s.id, s.status ?? "PRESENT"])));
        setNotice("");
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [date]);

  async function save() {
    try {
      const res = await api<{ saved: number }>("/hr/attendance", {
        method: "PUT",
        body: { date, records: Object.entries(marks).map(([userId, status]) => ({ userId, status })) },
      });
      setNotice(`Saved the register for ${res.saved} staff.`);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <Field label="Date" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
        <div className="flex items-center gap-3">
          {register?.taken && <Badge tone="green">taken</Badge>}
          <Button onClick={save} disabled={!register?.staff.length}>Save register</Button>
        </div>
      </div>
      <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/10">
        {register?.staff.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <div className="font-medium">{s.name}</div>
              {s.designation && <div className="text-xs opacity-60">{s.designation}</div>}
            </div>
            <div className="flex shrink-0 gap-1">
              {BUTTONS.map((b) => (
                <button
                  key={b.status}
                  onClick={() => setMarks((m) => ({ ...m, [s.id]: b.status }))}
                  aria-pressed={marks[s.id] === b.status}
                  aria-label={`${b.status.toLowerCase()} ${s.name}`}
                  className={`h-9 w-10 rounded-lg text-sm font-semibold ${marks[s.id] === b.status ? b.on : "bg-black/5 dark:bg-white/10"}`}
                >
                  {b.short}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <Notice>{notice}</Notice>
      <ErrorText>{error}</ErrorText>
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
const leaveTone = (s: Leave["status"]) => (s === "APPROVED" ? "green" : s === "REJECTED" ? "red" : "amber");

function LeaveTab({ isAdmin }: { isAdmin: boolean }) {
  const user = useSession();
  const leave = useApi<Leave[]>("/hr/leave");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const f = new FormData(form);
    try {
      await api("/hr/leave", {
        method: "POST",
        body: { type: f.get("type"), fromDate: f.get("fromDate"), toDate: f.get("toDate"), reason: f.get("reason") || undefined },
      });
      form.reset();
      setError("");
      setNotice("Leave request sent.");
      await leave.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function decide(id: string, approve: boolean) {
    try {
      await api(`/hr/leave/${id}/decide`, { method: "POST", body: { approve } });
      setError("");
      await leave.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <Card>
        <h2 className="mb-3 font-semibold">{isAdmin ? "Leave requests" : "My leave"}</h2>
        {leave.data?.length === 0 && <p className="text-sm opacity-70">No leave requests yet.</p>}
        <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/10">
          {leave.data?.map((l) => (
            <li key={l.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div>
                <div className="flex items-center gap-2">
                  {isAdmin && <span className="font-medium">{l.user.name}</span>}
                  <Badge tone={leaveTone(l.status)}>{l.status.toLowerCase()}</Badge>
                </div>
                <div className="text-sm">
                  {l.type.toLowerCase()} leave · {day(l.fromDate)}{l.toDate !== l.fromDate ? ` to ${day(l.toDate)}` : ""} · {l.days} working day{l.days === 1 ? "" : "s"}
                </div>
                {l.reason && <div className="text-xs opacity-70">{l.reason}</div>}
              </div>
              {isAdmin && l.status === "PENDING" && (l.userId !== user.sub || hasRole(user, ["OWNER"])) && (
                <div className="flex gap-2">
                  <Button onClick={() => decide(l.id, true)}>Approve</Button>
                  <Button variant="ghost" onClick={() => decide(l.id, false)}>Reject</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
        <ErrorText>{error || leave.error}</ErrorText>
      </Card>
      <Card>
        <h2 className="mb-4 font-semibold">Apply for leave</h2>
        <form className="flex flex-col gap-3" onSubmit={apply}>
          <Select
            label="Type"
            name="type"
            options={[
              { value: "CASUAL", label: "Casual" },
              { value: "SICK", label: "Sick" },
              { value: "ANNUAL", label: "Annual" },
              { value: "UNPAID", label: "Unpaid" },
            ]}
          />
          <Field label="From" name="fromDate" type="date" required defaultValue={todayIso()} />
          <Field label="To" name="toDate" type="date" required defaultValue={todayIso()} />
          <TextArea label="Reason (optional)" name="reason" rows={2} />
          <Button type="submit">Send request</Button>
          <Notice>{notice}</Notice>
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

function PayrollTab() {
  const runs = useApi<RunSummary[]>("/hr/payroll");
  const [openId, setOpenId] = useState<string | null>(null);
  const open = useApi<Run>(openId ? `/hr/payroll/${openId}` : null);
  const [period, setPeriod] = useState(thisMonth());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      setError("");
      await Promise.all([runs.reload(), open.reload()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const generate = () =>
    act(async () => {
      const run = await api<Run>("/hr/payroll", { method: "POST", body: { period } });
      setOpenId(run.id);
    });

  const run = open.data;
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Month" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          <Button onClick={generate} disabled={busy}>Calculate payroll</Button>
        </div>
        <p className="mt-2 text-xs opacity-60">Absent days and unpaid leave from the staff register are deducted at a day&apos;s basic salary. Recalculate a draft as often as you need; finalise it to lock it and start paying.</p>
        <ErrorText>{error}</ErrorText>
        {!!runs.data?.length && (
          <div className="mt-4 overflow-x-auto">
            <table className={tableClass}>
              <thead className="opacity-60"><tr><th className="py-2">Month</th><th>Staff</th><th>Net total</th><th>Paid</th><th>Status</th></tr></thead>
              <tbody>
                {runs.data.map((r) => (
                  <tr key={r.id} className={`${rowClass} cursor-pointer hover:bg-black/5 dark:hover:bg-white/5`} onClick={() => setOpenId(r.id)}>
                    <td className="py-2 font-medium">{r.period}</td>
                    <td>{r.staff}</td>
                    <td>{rupees(r.totalNet)}</td>
                    <td>{r.paid} of {r.staff}</td>
                    <td>{r.status === "FINALIZED" ? <Badge tone="green">finalised</Badge> : <Badge tone="amber">draft</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {run && (
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">Payroll {run.period} · {run.workingDays} working days · {rupees(run.totalNet)}</h2>
            {run.status === "DRAFT" && (
              <Button onClick={() => confirm("Finalise this month? Payslips can't be recalculated afterwards.") && act(() => api(`/hr/payroll/${run.id}/finalize`, { method: "POST" }))} disabled={busy}>
                Finalise
              </Button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead className="opacity-60">
                <tr><th className="py-2">Staff</th><th>Basic</th><th>Allowances</th><th>Deductions</th><th>Unpaid days</th><th>Net</th><th /></tr>
              </thead>
              <tbody>
                {run.payslips.map((p) => (
                  <tr key={p.id} className={rowClass}>
                    <td className="py-2">
                      <div className="font-medium">{p.user.name}</div>
                      <div className="text-xs opacity-60">{p.user.staffProfile?.employeeNo} · {p.user.staffProfile?.designation}</div>
                    </td>
                    <td>{rupees(p.basic)}</td>
                    <td>{rupees(p.allowances)}</td>
                    <td>{rupees(p.deductions + p.unpaidDeduction)}</td>
                    <td>{p.unpaidDays || "–"}</td>
                    <td className="font-semibold">{rupees(p.net)}</td>
                    <td className="whitespace-nowrap">
                      <Link href={`/hr/payslips/${p.id}`} className="mr-3 text-sm text-brand">Payslip</Link>
                      {run.status === "FINALIZED" &&
                        (p.paidAt ? (
                          <Badge tone="green">paid {p.paymentMethod?.toLowerCase()}</Badge>
                        ) : (
                          <button className="text-sm text-brand" disabled={busy} onClick={() => act(() => api(`/hr/payroll/${run.id}/payslips/${p.id}/pay`, { method: "POST", body: { method: "BANK" } }))}>
                            Mark paid
                          </button>
                        ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function MyPayslips() {
  const slips = useApi<{ id: string; net: number; paidAt: string | null; run: { period: string } }[]>("/hr/payslips/mine");
  return (
    <Card>
      <ErrorText>{slips.error}</ErrorText>
      {slips.data?.length === 0 && <p className="text-sm opacity-70">No payslips yet. They appear here once a month&apos;s payroll is finalised.</p>}
      <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/10">
        {slips.data?.map((s) => (
          <li key={s.id} className="flex items-center justify-between py-2 text-sm">
            <Link href={`/hr/payslips/${s.id}`} className="font-medium text-brand">{s.run.period}</Link>
            <span>{rupees(s.net)} {s.paidAt ? <Badge tone="green">paid</Badge> : <Badge tone="amber">not paid yet</Badge>}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
