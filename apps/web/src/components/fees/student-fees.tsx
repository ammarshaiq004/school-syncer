"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { BadgePercent, FilePlus2, Pencil, Plus, Trash2, Users } from "lucide-react";
import { InvoiceStatusPill } from "@/components/fees/invoice-status";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  SelectField,
  SkeletonRows,
  TextField,
  useToast,
  type Column,
} from "@/components/ui";
import { api } from "@/lib/api";
import { rupees, todayIso } from "@/lib/format";
import { can, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

export interface StudentInvoice {
  id: string;
  period: string;
  total: number;
  paid: number;
  status: string;
  dueDate: string;
  kind: "MONTHLY" | "ADHOC";
}

interface Concession {
  id: string;
  feeHeadId: string;
  type: "PERCENT" | "FIXED";
  value: number;
  reason: string | null;
  validFrom: string | null;
  validTo: string | null;
  feeHead: { name: string; frequency: string };
}

/** Shape of GET /fees/students/:id/fee-profile. */
interface FeeProfile {
  concessions: Concession[];
  sibling: {
    rank: number;
    familySize: number;
    percent: number;
    feeHeads: { id: string; name: string }[];
    siblings: { id: string | null; name: string; admissionNo: string | null }[];
  };
  oneTimeCharges: { feeHeadId: string; name: string; amount: number }[];
}

interface FeeHead {
  id: string;
  name: string;
  frequency: string;
}

const monthLabel = (period: string | null) =>
  period ? new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }) : "";

/** "Oct 2026 to Dec 2026", "from Oct 2026", "always". */
function validity(c: { validFrom: string | null; validTo: string | null }) {
  if (c.validFrom && c.validTo) return `${monthLabel(c.validFrom)} to ${monthLabel(c.validTo)}`;
  if (c.validFrom) return `From ${monthLabel(c.validFrom)}`;
  if (c.validTo) return `Until ${monthLabel(c.validTo)}`;
  return "Every month";
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;

const invoiceColumns: Column<StudentInvoice>[] = [
  {
    id: "period",
    header: "Month",
    sortValue: (i) => i.period,
    cell: (i) => (
      <Link className="font-medium text-fg hover:text-brand" href={`/fees/invoices/${i.id}`}>
        {i.kind === "ADHOC" ? `One-off, ${monthLabel(i.period)}` : i.period}
      </Link>
    ),
  },
  { id: "total", header: "Total", align: "right", sortValue: (i) => i.total, cell: (i) => rupees(i.total) },
  { id: "paid", header: "Paid", align: "right", sortValue: (i) => i.paid, cell: (i) => rupees(i.paid) },
  {
    id: "balance",
    header: "Balance",
    align: "right",
    hideBelow: "sm",
    sortValue: (i) => i.total - i.paid,
    cell: (i) => rupees(i.status === "UNPAID" || i.status === "PARTIAL" ? Math.max(0, i.total - i.paid) : 0),
  },
  { id: "status", header: "Status", cell: (i) => <InvoiceStatusPill invoice={i} /> },
];

/**
 * The fees area of a student's profile: their vouchers, concessions per fee
 * head (percent or fixed, for a span of months), their place among siblings
 * and the discount it earns, and one-off vouchers.
 */
export function StudentFees({ studentId, invoices, onChanged }: { studentId: string; invoices: StudentInvoice[]; onChanged: () => Promise<void> }) {
  const user = useSession();
  const toast = useToast();
  const router = useRouter();
  const canManage = can(user, "fees", "manage") && user.plan?.access !== "read_only";
  const profile = useApi<FeeProfile>(`/fees/students/${studentId}/fee-profile`);
  const heads = useApi<FeeHead[]>("/fees/heads");
  const [editing, setEditing] = useState<Concession | "new" | null>(null);
  const [removing, setRemoving] = useState<Concession | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [voucherOpen, setVoucherOpen] = useState(false);
  const p = profile.data;

  async function remove() {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      await api(`/fees/students/${studentId}/concessions/${removing.feeHeadId}`, { method: "DELETE" });
      toast.success("Concession removed", `${removing.feeHead.name} is billed in full from the next voucher.`);
      setRemoving(null);
      await profile.reload();
    } catch (e) {
      toast.error("Could not remove the concession", (e as Error).message);
    } finally {
      setRemoveBusy(false);
    }
  }

  const concessionColumns: Column<Concession>[] = [
    { id: "head", header: "Fee head", cell: (c) => <span className="font-medium text-fg">{c.feeHead.name}</span> },
    { id: "off", header: "Off", align: "right", cell: (c) => (c.type === "PERCENT" ? `${c.value}%` : rupees(c.value)) },
    { id: "when", header: "Months", hideBelow: "sm", cell: (c) => validity(c) },
    { id: "reason", header: "Reason", hideBelow: "md", cell: (c) => c.reason ?? <span className="text-fg-muted">None given</span> },
    ...(canManage
      ? [
          {
            id: "actions",
            header: <span className="sr-only">Actions</span>,
            align: "right" as const,
            cell: (c: Concession) => (
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" icon={<Pencil />} onClick={() => setEditing(c)} aria-label={`Change the ${c.feeHead.name} concession`}>
                  Change
                </Button>
                <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => setRemoving(c)} aria-label={`Remove the ${c.feeHead.name} concession`}>
                  Remove
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <DataTable
        label="Invoices"
        columns={invoiceColumns}
        data={invoices}
        getRowId={(i) => i.id}
        pageSize={0}
        defaultSort={{ id: "period", dir: "desc" }}
        toolbarActions={
          canManage ? (
            <Button size="sm" variant="secondary" icon={<FilePlus2 />} onClick={() => setVoucherOpen(true)}>
              One-off voucher
            </Button>
          ) : undefined
        }
        empty={{ title: "No invoices yet", description: "Monthly invoices appear here once fees are generated." }}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card padding="none" className="overflow-hidden">
          <div className="p-4 pb-0 sm:p-5 sm:pb-0">
            <CardHeader
              icon={<BadgePercent />}
              title="Concessions"
              description="Taken off a fee head on every voucher in the months it covers, on its own line."
              action={
                canManage ? (
                  <Button size="sm" variant="secondary" icon={<Plus />} onClick={() => setEditing("new")}>
                    Add concession
                  </Button>
                ) : undefined
              }
            />
          </div>
          {profile.error ? (
            <ErrorState message={profile.error} onRetry={profile.reload} compact />
          ) : !p ? (
            <div className="p-4 sm:p-5">
              <SkeletonRows rows={2} columns={3} />
            </div>
          ) : (
            <DataTable
              label="Concessions"
              columns={concessionColumns}
              data={p.concessions}
              getRowId={(c) => c.id}
              pageSize={0}
              bare
              empty={{ icon: <BadgePercent />, title: "No concessions", description: "This student pays the class fee in full." }}
            />
          )}
        </Card>

        <Card className="self-start">
          <CardHeader icon={<Users />} title="Siblings" description="Found through a shared guardian." />
          {!p ? (
            <SkeletonRows rows={2} columns={1} />
          ) : p.sibling.familySize <= 1 ? (
            <EmptyState title="No siblings at the school" description="Children who share a guardian are counted as one family." compact />
          ) : (
            <div className="flex flex-col gap-3 text-sm">
              <p className="text-fg-secondary">
                {ordinal(p.sibling.rank)} of {p.sibling.familySize} children by admission.{" "}
                {p.sibling.percent > 0 ? (
                  <>
                    Gets <Badge tone="success">{p.sibling.percent}% sibling discount</Badge>
                    {p.sibling.feeHeads.length ? ` on ${p.sibling.feeHeads.map((h) => h.name).join(", ")}.` : ", but no fee head is chosen in Fee rules."}
                  </>
                ) : p.sibling.rank === 1 ? (
                  "The first child pays in full."
                ) : (
                  "The school has no sibling discount set."
                )}
              </p>
              <ul className="divide-y divide-border">
                {p.sibling.siblings.map((s, i) => (
                  <li key={s.id ?? `hidden-${i}`} className="py-2">
                    {s.id ? (
                      <Link className="font-medium text-fg hover:text-brand" href={`/students/${s.id}`}>
                        {s.name}
                      </Link>
                    ) : (
                      <span className="text-fg-muted">{s.name}</span>
                    )}
                    {s.admissionNo && <span className="ms-2 text-xs text-fg-muted">{s.admissionNo}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      {canManage && (
        <ConcessionDialog
          key={editing === "new" ? "new" : (editing?.id ?? "closed")}
          studentId={studentId}
          concession={editing === "new" ? null : editing}
          open={editing !== null}
          onOpenChange={(o) => !o && setEditing(null)}
          heads={(heads.data ?? []).filter((h) => editing === "new" ? !p?.concessions.some((c) => c.feeHeadId === h.id) : true)}
          onSaved={async () => {
            toast.success("Concession saved", "It applies from the next voucher run.");
            setEditing(null);
            await profile.reload();
          }}
        />
      )}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove this concession?"
        description={removing ? `${removing.feeHead.name} is billed in full from the next voucher. Vouchers already issued keep their concession line.` : ""}
        confirmLabel="Remove concession"
        destructive
        loading={removeBusy}
        onConfirm={remove}
      />
      {canManage && (
        <AdhocVoucherDialog
          open={voucherOpen}
          onOpenChange={setVoucherOpen}
          studentId={studentId}
          charges={p?.oneTimeCharges ?? []}
          heads={heads.data ?? []}
          onCreated={async (id) => {
            toast.success("Voucher created");
            setVoucherOpen(false);
            await onChanged();
            router.push(`/fees/invoices/${id}`);
          }}
        />
      )}
    </div>
  );
}

function ConcessionDialog({
  studentId,
  concession,
  open,
  onOpenChange,
  heads,
  onSaved,
}: {
  studentId: string;
  concession: Concession | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  heads: FeeHead[];
  onSaved: () => Promise<void>;
}) {
  const [type, setType] = useState<"PERCENT" | "FIXED">(concession?.type ?? "PERCENT");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await api(`/fees/students/${studentId}/concessions`, {
        method: "PUT",
        body: {
          feeHeadId: concession?.feeHeadId ?? f.get("feeHeadId"),
          type,
          value: Number(f.get("value")),
          reason: f.get("reason") || undefined,
          validFrom: f.get("validFrom") || null,
          validTo: f.get("validTo") || null,
        },
      });
      setError("");
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={concession ? `Change the ${concession.feeHead.name} concession` : "Add concession"}
      description="One concession per fee head. Vouchers already issued are not changed."
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="concession-form" loading={busy}>
            Save concession
          </Button>
        </>
      }
    >
      <form id="concession-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        {concession ? (
          <TextField label="Fee head" value={concession.feeHead.name} readOnly wrapperClassName="sm:col-span-2" />
        ) : heads.length ? (
          <SelectField label="Fee head" name="feeHeadId" required options={heads.map((h) => ({ value: h.id, label: h.name }))} wrapperClassName="sm:col-span-2" />
        ) : (
          <Alert tone="info" className="sm:col-span-2">
            Every fee head already has a concession for this student. Change one instead.
          </Alert>
        )}
        <SelectField
          label="Type"
          value={type}
          onChange={(e) => setType(e.target.value as "PERCENT" | "FIXED")}
          options={[
            { value: "PERCENT", label: "Percent off" },
            { value: "FIXED", label: "Fixed rupees off" },
          ]}
        />
        <TextField
          label={type === "PERCENT" ? "Percent" : "Rupees"}
          name="value"
          type="number"
          min={1}
          max={type === "PERCENT" ? 100 : undefined}
          required
          defaultValue={concession?.value}
          inputMode="numeric"
        />
        <TextField label="First month" name="validFrom" type="month" defaultValue={concession?.validFrom ?? ""} hint="Empty: from now on" />
        <TextField label="Last month" name="validTo" type="month" defaultValue={concession?.validTo ?? ""} hint="Empty: no end" />
        <TextField label="Reason" name="reason" maxLength={200} defaultValue={concession?.reason ?? ""} placeholder="Staff child, merit scholarship" wrapperClassName="sm:col-span-2" />
        {error && (
          <Alert tone="danger" className="sm:col-span-2">
            {error}
          </Alert>
        )}
      </form>
    </Dialog>
  );
}

interface DraftLine {
  key: number;
  feeHeadId: string;
  description: string;
  amount: string;
}

/** Bills one student for one-off charges: admission or registration fee, a uniform, a trip. */
function AdhocVoucherDialog({
  open,
  onOpenChange,
  studentId,
  charges,
  heads,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentId: string;
  charges: FeeProfile["oneTimeCharges"];
  heads: FeeHead[];
  onCreated: (id: string) => Promise<void>;
}) {
  const blank = (key: number): DraftLine => ({ key, feeHeadId: "", description: "", amount: "" });
  const [lines, setLines] = useState<DraftLine[]>([blank(0)]);
  const [dueDate, setDueDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (key: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const res = await api<{ id: string }>(`/fees/students/${studentId}/vouchers`, {
        method: "POST",
        body: {
          dueDate,
          lines: lines.map((l) => ({ feeHeadId: l.feeHeadId || undefined, description: l.description || undefined, amount: Number(l.amount) })),
        },
      });
      setError("");
      setLines([blank(0)]);
      await onCreated(res.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setError("");
      }}
      title="One-off voucher"
      description="A separate voucher for charges outside the monthly fee. The monthly voucher is not affected."
      size="lg"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="adhoc-voucher" loading={busy} icon={<FilePlus2 />}>
            Create voucher for {rupees(total)}
          </Button>
        </>
      }
    >
      <form id="adhoc-voucher" onSubmit={submit} className="flex flex-col gap-4">
        {lines.map((l, i) => (
          <div key={l.key} className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem_auto]">
            <SelectField
              label={i === 0 ? "Fee head" : undefined}
              aria-label="Fee head"
              value={l.feeHeadId}
              onChange={(e) => {
                const charge = charges.find((c) => c.feeHeadId === e.target.value);
                set(l.key, { feeHeadId: e.target.value, ...(charge && !l.amount ? { amount: String(charge.amount) } : {}) });
              }}
              options={[{ value: "", label: "Other charge" }, ...heads.map((h) => ({ value: h.id, label: h.name }))]}
            />
            <TextField
              label={i === 0 ? "Line text" : undefined}
              aria-label="Line text"
              value={l.description}
              onChange={(e) => set(l.key, { description: e.target.value })}
              maxLength={80}
              required={!l.feeHeadId}
              placeholder={l.feeHeadId ? "As the fee head" : "Uniform"}
            />
            <TextField
              label={i === 0 ? "Amount (Rs)" : undefined}
              aria-label="Amount in rupees"
              type="number"
              min={1}
              required
              inputMode="numeric"
              value={l.amount}
              onChange={(e) => set(l.key, { amount: e.target.value })}
            />
            <Button
              type="button"
              variant="ghost"
              icon={<Trash2 />}
              disabled={lines.length === 1}
              onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
              aria-label="Remove this charge"
            />
          </div>
        ))}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            icon={<Plus />}
            disabled={lines.length >= 10}
            onClick={() => setLines((ls) => [...ls, blank(Math.max(...ls.map((x) => x.key)) + 1)])}
          >
            Add charge
          </Button>
          <TextField label="Due date" type="date" min={todayIso()} required value={dueDate} onChange={(e) => setDueDate(e.target.value)} wrapperClassName="w-44" />
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}
