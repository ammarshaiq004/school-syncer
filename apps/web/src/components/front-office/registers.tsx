"use client";

import { useState } from "react";
import { Cake, LogOut, Plus, Trash2, Undo2 } from "lucide-react";
import { Button, DataTable, Field, Input, NativeSelect, SegmentedControl, SelectField, StatusPill, TextareaField, useToast, type Column } from "@/components/ui";
import { formBody, RecordDrawer, StudentPicker, timeOf } from "@/components/front-office/common";
import { api } from "@/lib/api";
import { day, todayIso } from "@/lib/format";
import { useApi } from "@/lib/use-api";

const add = (label: string, onClick: () => void) => (
  <Button icon={<Plus />} onClick={onClick}>
    {label}
  </Button>
);

/** Run an action on a row, then reload the list. */
function useRowAction(reload: () => void | Promise<void>) {
  const toast = useToast();
  return async (path: string, method: "PATCH" | "DELETE" = "PATCH") => {
    try {
      await api(path, { method });
      await reload();
    } catch (e) {
      toast.error("Could not save", (e as Error).message);
    }
  };
}

// ----- Visitors -----

interface Visitor {
  id: string;
  name: string;
  phone: string | null;
  purpose: string;
  meetingWith: string | null;
  headcount: number;
  cardNo: string | null;
  checkedInAt: string;
  checkedOutAt: string | null;
  minutes: number | null;
}

export function Visitors() {
  const [date, setDate] = useState(todayIso());
  const [open, setOpen] = useState(false);
  const list = useApi<Visitor[]>(`/front-office/visitors?date=${date}`);
  const act = useRowAction(list.reload);
  const columns: Column<Visitor>[] = [
    { id: "name", header: "Visitor", cell: (v) => <span className="font-medium">{v.name}{v.headcount > 1 ? ` +${v.headcount - 1}` : ""}</span>, sortValue: (v) => v.name },
    { id: "purpose", header: "Purpose", cell: (v) => v.purpose, hideBelow: "sm" },
    { id: "meeting", header: "Meeting", cell: (v) => v.meetingWith ?? "-", hideBelow: "md" },
    { id: "card", header: "Pass", cell: (v) => v.cardNo ?? "-", hideBelow: "lg" },
    { id: "in", header: "In", cell: (v) => timeOf(v.checkedInAt), sortValue: (v) => v.checkedInAt },
    {
      id: "out",
      header: "Out",
      cell: (v) =>
        v.checkedOutAt ? (
          <span>{timeOf(v.checkedOutAt)} <span className="text-fg-muted">({v.minutes} min)</span></span>
        ) : (
          <Button size="sm" variant="secondary" icon={<LogOut />} onClick={() => act(`/front-office/visitors/${v.id}/checkout`)}>
            Check out
          </Button>
        ),
    },
  ];
  return (
    <>
      <DataTable
        label="Visitors"
        columns={columns}
        data={list.data}
        error={list.error}
        onRetry={list.reload}
        getRowId={(v) => v.id}
        getSearchText={(v) => `${v.name} ${v.phone ?? ""} ${v.meetingWith ?? ""}`}
        searchPlaceholder="Search visitors"
        filters={<Input aria-label="Day" type="date" className="w-44" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />}
        toolbarActions={add("New visitor", () => setOpen(true))}
        empty={{ title: "No visitors on this day" }}
      />
      <RecordDrawer open={open} onOpenChange={setOpen} title="New visitor" path="/front-office/visitors" onSaved={list.reload}
        toBody={(f) => {
          const b: Record<string, unknown> = formBody(f);
          if (b.headcount) b.headcount = Number(b.headcount);
          return b;
        }}>
        <Field label="Name" name="name" required />
        <Field label="Phone" name="phone" type="tel" />
        <Field label="CNIC" name="cnic" />
        <Field label="Purpose of visit" name="purpose" required />
        <Field label="Meeting with" name="meetingWith" />
        <Field label="Number of people" name="headcount" type="number" min={1} max={50} defaultValue={1} />
        <Field label="Visitor pass number" name="cardNo" />
        <TextareaField label="Note" name="note" rows={2} />
      </RecordDrawer>
    </>
  );
}

// ----- Post register -----

interface Postal {
  id: string;
  direction: "RECEIVED" | "SENT";
  date: string;
  party: string;
  subject: string;
  referenceNo: string | null;
  mode: string | null;
}

export function Postal() {
  const [direction, setDirection] = useState("");
  const [open, setOpen] = useState(false);
  const list = useApi<Postal[]>(`/front-office/postal${direction ? `?direction=${direction}` : ""}`);
  const columns: Column<Postal>[] = [
    { id: "date", header: "Date", cell: (p) => day(p.date), sortValue: (p) => p.date },
    { id: "dir", header: "Type", cell: (p) => <StatusPill status={p.direction} tone={p.direction === "RECEIVED" ? "info" : "primary"} label={p.direction === "RECEIVED" ? "Received" : "Sent"} /> },
    { id: "party", header: "From / to", cell: (p) => <span className="font-medium">{p.party}</span>, sortValue: (p) => p.party },
    { id: "subject", header: "Subject", cell: (p) => p.subject },
    { id: "ref", header: "Reference", cell: (p) => [p.referenceNo, p.mode].filter(Boolean).join(" / ") || "-", hideBelow: "md" },
  ];
  return (
    <>
      <DataTable
        label="Post register"
        columns={columns}
        data={list.data}
        error={list.error}
        onRetry={list.reload}
        getRowId={(p) => p.id}
        getSearchText={(p) => `${p.party} ${p.subject} ${p.referenceNo ?? ""}`}
        searchPlaceholder="Search post"
        filters={
          <SegmentedControl
            aria-label="Direction"
            value={direction}
            onChange={setDirection}
            options={[{ value: "", label: "All" }, { value: "RECEIVED", label: "Received" }, { value: "SENT", label: "Sent" }]}
          />
        }
        toolbarActions={add("New entry", () => setOpen(true))}
        empty={{ title: "Nothing in the post register yet" }}
      />
      <RecordDrawer open={open} onOpenChange={setOpen} title="New post entry" path="/front-office/postal" onSaved={list.reload}>
        <SelectField label="Type" name="direction" required options={[{ value: "RECEIVED", label: "Received" }, { value: "SENT", label: "Sent" }]} />
        <Field label="Date" name="date" type="date" defaultValue={todayIso()} />
        <Field label="From / to" name="party" required />
        <Field label="Subject" name="subject" required />
        <Field label="Reference or tracking number" name="referenceNo" />
        <Field label="Sent by" name="mode" placeholder="TCS, by hand, registered post" />
        <TextareaField label="Note" name="note" rows={2} />
      </RecordDrawer>
    </>
  );
}

// ----- Short leave -----

interface ShortLeave {
  id: string;
  studentName: string;
  admissionNo: string;
  className: string | null;
  reason: string;
  pickedUpBy: string;
  relation: string | null;
  leftAt: string;
  returnedAt: string | null;
}

export function ShortLeaves() {
  const [date, setDate] = useState(todayIso());
  const [open, setOpen] = useState(false);
  const list = useApi<ShortLeave[]>(`/front-office/short-leaves?date=${date}`);
  const act = useRowAction(list.reload);
  const columns: Column<ShortLeave>[] = [
    { id: "student", header: "Student", cell: (l) => <span><span className="font-medium">{l.studentName}</span> <span className="text-fg-muted">{l.className}</span></span>, sortValue: (l) => l.studentName },
    { id: "reason", header: "Reason", cell: (l) => l.reason, hideBelow: "sm" },
    { id: "by", header: "Collected by", cell: (l) => `${l.pickedUpBy}${l.relation ? ` (${l.relation})` : ""}`, hideBelow: "md" },
    { id: "left", header: "Left", cell: (l) => timeOf(l.leftAt), sortValue: (l) => l.leftAt },
    {
      id: "back",
      header: "Back",
      cell: (l) =>
        l.returnedAt ? (
          timeOf(l.returnedAt)
        ) : (
          <Button size="sm" variant="secondary" icon={<Undo2 />} onClick={() => act(`/front-office/short-leaves/${l.id}/return`)}>
            Mark back
          </Button>
        ),
    },
  ];
  return (
    <>
      <DataTable
        label="Short leave"
        columns={columns}
        data={list.data}
        error={list.error}
        onRetry={list.reload}
        getRowId={(l) => l.id}
        getSearchText={(l) => `${l.studentName} ${l.admissionNo} ${l.pickedUpBy}`}
        searchPlaceholder="Search short leave"
        filters={<Input aria-label="Day" type="date" className="w-44" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />}
        toolbarActions={add("New short leave", () => setOpen(true))}
        empty={{ title: "No short leave on this day" }}
      />
      <RecordDrawer open={open} onOpenChange={setOpen} title="New short leave" path="/front-office/short-leaves" onSaved={list.reload}>
        <StudentPicker required />
        <Field label="Reason" name="reason" required />
        <Field label="Collected by" name="pickedUpBy" required />
        <Field label="Relation" name="relation" placeholder="Father, driver..." />
      </RecordDrawer>
    </>
  );
}

// ----- Complaints -----

interface Complaint {
  id: string;
  complainant: string;
  phone: string | null;
  studentName: string | null;
  category: string;
  description: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED";
  resolution: string | null;
  createdAt: string;
}

const CATEGORIES = ["Academics", "Fees", "Transport", "Staff conduct", "Discipline", "Facilities", "Other"];

export function Complaints() {
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(false);
  const [resolving, setResolving] = useState<Complaint | null>(null);
  const list = useApi<Complaint[]>(`/front-office/complaints${status ? `?status=${status}` : ""}`);
  const columns: Column<Complaint>[] = [
    { id: "date", header: "Date", cell: (c) => day(c.createdAt), sortValue: (c) => c.createdAt },
    { id: "who", header: "Complainant", cell: (c) => <span><span className="font-medium">{c.complainant}</span>{c.studentName ? <span className="text-fg-muted"> for {c.studentName}</span> : null}</span> },
    { id: "cat", header: "Category", cell: (c) => c.category, hideBelow: "md" },
    { id: "text", header: "Complaint", cell: (c) => <span className="line-clamp-2">{c.description}{c.resolution ? <span className="text-fg-muted"> Resolved: {c.resolution}</span> : null}</span>, hideBelow: "sm" },
    { id: "status", header: "Status", cell: (c) => <StatusPill status={c.status} tone={c.status === "RESOLVED" ? "success" : c.status === "OPEN" ? "warning" : "info"} /> },
    {
      id: "act",
      header: "",
      cell: (c) =>
        c.status === "RESOLVED" ? null : (
          <span className="flex gap-2">
            {c.status === "OPEN" && (
              <Button size="sm" variant="secondary" onClick={() => api(`/front-office/complaints/${c.id}`, { method: "PATCH", body: { status: "IN_PROGRESS" } }).then(list.reload)}>
                Start
              </Button>
            )}
            <Button size="sm" onClick={() => setResolving(c)}>
              Resolve
            </Button>
          </span>
        ),
    },
  ];
  return (
    <>
      <DataTable
        label="Complaints"
        columns={columns}
        data={list.data}
        error={list.error}
        onRetry={list.reload}
        getRowId={(c) => c.id}
        getSearchText={(c) => `${c.complainant} ${c.category} ${c.description} ${c.studentName ?? ""}`}
        searchPlaceholder="Search complaints"
        filters={
          <NativeSelect aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}
            options={[{ value: "", label: "All" }, { value: "OPEN", label: "Open" }, { value: "IN_PROGRESS", label: "In progress" }, { value: "RESOLVED", label: "Resolved" }]} />
        }
        toolbarActions={add("New complaint", () => setOpen(true))}
        empty={{ title: "No complaints" }}
      />
      <RecordDrawer open={open} onOpenChange={setOpen} title="New complaint" path="/front-office/complaints" onSaved={list.reload}>
        <Field label="Complainant" name="complainant" required />
        <Field label="Phone" name="phone" type="tel" />
        <SelectField label="Category" name="category" required options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
        <StudentPicker />
        <TextareaField label="What happened" name="description" required />
      </RecordDrawer>
      <RecordDrawer
        key={resolving?.id ?? "none"}
        open={Boolean(resolving)}
        onOpenChange={(o) => !o && setResolving(null)}
        title="Resolve complaint"
        path={`/front-office/complaints/${resolving?.id}`}
        method="PATCH"
        toBody={(f) => ({ status: "RESOLVED", ...formBody(f) })}
        onSaved={list.reload}
      >
        <p className="text-sm text-fg-muted">{resolving?.description}</p>
        <TextareaField label="How it was resolved" name="resolution" required />
      </RecordDrawer>
    </>
  );
}

// ----- Phone book -----

interface Contact {
  id: string;
  name: string;
  organisation: string | null;
  category: string | null;
  phone: string;
  email: string | null;
}

export function Contacts() {
  const [open, setOpen] = useState(false);
  const list = useApi<Contact[]>("/front-office/contacts");
  const act = useRowAction(list.reload);
  const columns: Column<Contact>[] = [
    { id: "name", header: "Name", cell: (c) => <span className="font-medium">{c.name}</span>, sortValue: (c) => c.name },
    { id: "org", header: "Organisation", cell: (c) => c.organisation ?? "-", hideBelow: "sm" },
    { id: "cat", header: "Category", cell: (c) => c.category ?? "-", hideBelow: "md" },
    { id: "phone", header: "Phone", cell: (c) => <a className="text-brand hover:underline" href={`tel:${c.phone}`}>{c.phone}</a> },
    { id: "email", header: "Email", cell: (c) => c.email ?? "-", hideBelow: "lg" },
    { id: "del", header: "", cell: (c) => <Button size="sm" variant="ghost" aria-label={`Delete ${c.name}`} icon={<Trash2 />} onClick={() => act(`/front-office/contacts/${c.id}`, "DELETE")} /> },
  ];
  return (
    <>
      <DataTable
        label="Phone book"
        columns={columns}
        data={list.data}
        error={list.error}
        onRetry={list.reload}
        getRowId={(c) => c.id}
        getSearchText={(c) => `${c.name} ${c.organisation ?? ""} ${c.category ?? ""} ${c.phone}`}
        searchPlaceholder="Search contacts"
        toolbarActions={add("New contact", () => setOpen(true))}
        empty={{ title: "No contacts yet", description: "Vendors, board offices, doctors: anyone the office calls." }}
      />
      <RecordDrawer open={open} onOpenChange={setOpen} title="New contact" path="/front-office/contacts" onSaved={list.reload}>
        <Field label="Name" name="name" required />
        <Field label="Organisation" name="organisation" />
        <Field label="Category" name="category" placeholder="Vendor, board office, medical" />
        <Field label="Phone" name="phone" type="tel" required />
        <Field label="Email" name="email" type="email" />
        <Field label="Address" name="address" />
        <TextareaField label="Note" name="note" rows={2} />
      </RecordDrawer>
    </>
  );
}

// ----- Birthdays -----

interface Birthday {
  id: string;
  name: string;
  date: string;
  daysAway: number;
  turning: number;
  className: string | null;
}

export function Birthdays() {
  const [days, setDays] = useState("30");
  const list = useApi<Birthday[]>(`/front-office/birthdays?days=${days}`);
  const columns: Column<Birthday>[] = [
    { id: "when", header: "When", cell: (b) => (b.daysAway === 0 ? <StatusPill status="today" tone="success" label="Today" /> : b.daysAway === 1 ? "Tomorrow" : day(b.date)), sortValue: (b) => b.daysAway },
    { id: "name", header: "Student", cell: (b) => <span className="inline-flex items-center gap-2 font-medium"><Cake className="size-4 text-fg-muted" aria-hidden />{b.name}</span>, sortValue: (b) => b.name },
    { id: "class", header: "Class", cell: (b) => b.className ?? "-", hideBelow: "sm" },
    { id: "turning", header: "Turning", cell: (b) => b.turning },
  ];
  return (
    <DataTable
      label="Birthdays"
      columns={columns}
      data={list.data}
      error={list.error}
      onRetry={list.reload}
      getRowId={(b) => b.id}
      getSearchText={(b) => b.name}
      searchPlaceholder="Search students"
      defaultSort={{ id: "when", dir: "asc" }}
      filters={
        <NativeSelect aria-label="Window" value={days} onChange={(e) => setDays(e.target.value)}
          options={[{ value: "0", label: "Today" }, { value: "7", label: "Next 7 days" }, { value: "30", label: "Next 30 days" }, { value: "90", label: "Next 90 days" }]} />
      }
      empty={{ title: "No birthdays in this window", description: "Only students with a date of birth on file are listed." }}
    />
  );
}
