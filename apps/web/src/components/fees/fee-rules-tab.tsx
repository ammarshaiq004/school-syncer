"use client";

import { useState, type FormEvent } from "react";
import { CalendarClock, History, Save, Users } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  DataTable,
  ErrorState,
  SelectField,
  SkeletonRows,
  Switch,
  TextField,
  useToast,
  type Column,
} from "@/components/ui";
import { api } from "@/lib/api";
import { day, plural, rupees } from "@/lib/format";
import { can, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

/** Shape of GET/PUT /fees/policy. */
export interface FeePolicy {
  lateFeePerDay: number;
  lateFeeMaxDays: number | null;
  lateFeeCap: number | null;
  feeDueDay: number;
  siblingSecondPercent: number;
  siblingThirdPercent: number;
  siblingFeeHeadIds: string[];
  admissionFeeHeadId: string | null;
  carryForwardArrears: boolean;
}

/** What POST /fees/invoices/generate answers with. */
export interface RunSummary {
  runId: string;
  period: string;
  students: number;
  created: number;
  alreadyBilled: number;
  skipped: number;
  carriedForward: number;
  totalBilled: number;
  messages: number;
}

/** A row of GET /fees/voucher-runs. */
interface VoucherRun {
  id: string;
  period: string;
  status: "RUNNING" | "DONE" | "FAILED";
  startedAt: string;
  finishedAt: string | null;
  students: number;
  created: number;
  skipped: number;
  carried: number;
  totalBilled: number;
  error: string | null;
}

interface FeeHead {
  id: string;
  name: string;
  frequency: string;
}

const RUN_TONE = { RUNNING: "warning", DONE: "success", FAILED: "danger" } as const;
const RUN_LABEL = { RUNNING: "Running", DONE: "Finished", FAILED: "Stopped" } as const;

const monthLabel = (period: string) =>
  new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/** A number box's value, or null when left empty. */
const optional = (v: FormDataEntryValue | null) => (v === null || v === "" ? null : Number(v));

/**
 * School-wide fee rules: late fine caps, the sibling discount, the admission
 * fee billed on admission and carrying balances forward, plus the history of
 * voucher runs.
 */
export function FeeRulesTab() {
  const user = useSession();
  const canManage = can(user, "fees", "manage") && user.plan?.access !== "read_only";
  const policy = useApi<FeePolicy>("/fees/policy");
  const heads = useApi<FeeHead[]>("/fees/heads");
  const runs = useApi<VoucherRun[]>("/fees/voucher-runs");

  return (
    <div className="flex flex-col gap-6">
      {policy.error || heads.error ? (
        <Card padding="none">
          <ErrorState
            message={policy.error || heads.error}
            onRetry={() => {
              void policy.reload();
              void heads.reload();
            }}
          />
        </Card>
      ) : !policy.data || !heads.data ? (
        <Card>
          <SkeletonRows rows={6} columns={2} />
        </Card>
      ) : (
        <PolicyForm
          // Remount after a save so the form shows what the server kept.
          key={JSON.stringify(policy.data)}
          policy={policy.data}
          heads={heads.data}
          readOnly={!canManage}
          onSaved={policy.reload}
        />
      )}
      <RunsCard runs={runs} />
    </div>
  );
}

function PolicyForm({
  policy,
  heads,
  readOnly,
  onSaved,
}: {
  policy: FeePolicy;
  heads: FeeHead[];
  readOnly: boolean;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [siblingHeads, setSiblingHeads] = useState<string[]>(policy.siblingFeeHeadIds);
  const [carry, setCarry] = useState(policy.carryForwardArrears);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [perDay, setPerDay] = useState(String(policy.lateFeePerDay));
  const [maxDays, setMaxDays] = useState(policy.lateFeeMaxDays?.toString() ?? "");
  const [cap, setCap] = useState(policy.lateFeeCap?.toString() ?? "");
  const oneTime = heads.filter((h) => h.frequency === "ONE_TIME");
  const recurring = heads.filter((h) => h.frequency !== "ONE_TIME");

  // What a voucher paid 30 days late would be fined, for the summary line.
  const example = (() => {
    const days = maxDays ? Math.min(30, Number(maxDays)) : 30;
    const fine = days * (Number(perDay) || 0);
    return cap ? Math.min(fine, Number(cap)) : fine;
  })();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await api("/fees/policy", {
        method: "PUT",
        body: {
          lateFeePerDay: Number(f.get("lateFeePerDay")),
          lateFeeMaxDays: optional(f.get("lateFeeMaxDays")),
          lateFeeCap: optional(f.get("lateFeeCap")),
          siblingSecondPercent: Number(f.get("siblingSecondPercent")),
          siblingThirdPercent: Number(f.get("siblingThirdPercent")),
          siblingFeeHeadIds: siblingHeads,
          admissionFeeHeadId: f.get("admissionFeeHeadId") || null,
          carryForwardArrears: carry,
        },
      });
      setError("");
      toast.success("Fee rules saved", "They apply from the next voucher run and payment.");
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader icon={<CalendarClock />} title="Late fine" description="Builds up per day once a voucher is overdue, within the limits below." />
        <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-3">
          <TextField label="Per day (Rs)" name="lateFeePerDay" type="number" min={0} max={100000} required value={perDay} onChange={(e) => setPerDay(e.target.value)} />
          <TextField label="At most (days)" name="lateFeeMaxDays" type="number" min={1} max={366} value={maxDays} onChange={(e) => setMaxDays(e.target.value)} hint="Empty: no limit" />
          <TextField label="Cap per voucher (Rs)" name="lateFeeCap" type="number" min={1} value={cap} onChange={(e) => setCap(e.target.value)} hint="Empty: no cap" />
        </fieldset>
        <p className="mt-4 text-sm text-fg-secondary">
          {Number(perDay) > 0
            ? `A voucher paid 30 days late is fined ${rupees(example)}. The fine is added to the voucher when a payment is taken, so it stays owing if only the balance is paid. It can be waived on the voucher, with a reason.`
            : "No late fine is charged."}
        </p>
      </Card>

      <Card>
        <CardHeader icon={<Users />} title="Sibling discount" description="Brothers and sisters are found through a shared guardian. The first child admitted pays in full." />
        <fieldset disabled={readOnly} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Second child (%)" name="siblingSecondPercent" type="number" min={0} max={100} required defaultValue={policy.siblingSecondPercent} />
            <TextField label="Third child and later (%)" name="siblingThirdPercent" type="number" min={0} max={100} required defaultValue={policy.siblingThirdPercent} />
          </div>
          <div>
            <div className="text-[13px] font-medium text-fg-secondary">Applies to</div>
            {recurring.length === 0 ? (
              <p className="mt-1 text-sm text-fg-muted">Add a fee head on the Fee setup tab first.</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                {recurring.map((h) => (
                  <Checkbox
                    key={h.id}
                    label={h.name}
                    disabled={readOnly}
                    checked={siblingHeads.includes(h.id)}
                    onCheckedChange={(on) => setSiblingHeads((ids) => (on ? [...ids, h.id] : ids.filter((id) => id !== h.id)))}
                  />
                ))}
              </div>
            )}
          </div>
        </fieldset>
        <p className="mt-4 text-sm text-fg-secondary">
          The discount comes off after any concession, on its own line of the voucher.
        </p>
      </Card>

      <Card>
        <CardHeader title="Admission fee" description="Billed on its own voucher, due in a week, when a student is admitted." />
        <fieldset disabled={readOnly}>
          <SelectField
            label="Fee head"
            name="admissionFeeHeadId"
            defaultValue={policy.admissionFeeHeadId ?? ""}
            options={[{ value: "", label: "Do not bill an admission fee" }, ...oneTime.map((h) => ({ value: h.id, label: h.name }))]}
            hint={oneTime.length ? "The amount is what the Fee setup tab sets for the student's class" : "Add a one-time fee head on the Fee setup tab first"}
          />
        </fieldset>
      </Card>

      <Card>
        <CardHeader title="Unpaid balances" description="What happens to an overdue voucher when the next month is billed." />
        <Switch
          checked={carry}
          onCheckedChange={setCarry}
          disabled={readOnly}
          label="Carry overdue balances onto the next month's voucher"
        />
        <p className="mt-3 text-sm text-fg-secondary">
          {carry
            ? "The old voucher is marked carried forward and owes nothing; the balance, with any late fine so far, becomes an arrears line on the new voucher. It is only ever counted once."
            : "Each voucher keeps its own balance until it is paid. You can still carry balances for one run from the Generate vouchers dialog."}
        </p>
      </Card>

      {(error || !readOnly) && (
        <div className="flex flex-col gap-3 lg:col-span-2">
          {error && <Alert tone="danger">{error}</Alert>}
          {!readOnly && (
            <div className="flex justify-end">
              <Button type="submit" loading={busy} icon={<Save />}>
                Save fee rules
              </Button>
            </div>
          )}
        </div>
      )}
    </form>
  );
}

function RunsCard({ runs }: { runs: { data: VoucherRun[] | null; error: string; reload: () => Promise<void> } }) {
  const columns: Column<VoucherRun>[] = [
    {
      id: "month",
      header: "Month",
      cell: (r) => (
        <div>
          <div className="font-medium text-fg">{monthLabel(r.period)}</div>
          <div className="text-xs text-fg-muted">{day(r.startedAt)}</div>
        </div>
      ),
    },
    {
      id: "status",
      header: "Run",
      cell: (r) => (
        <div className="flex flex-col items-start gap-0.5">
          <Badge tone={RUN_TONE[r.status]}>{RUN_LABEL[r.status]}</Badge>
          {r.error && <span className="max-w-64 text-xs text-fg-muted">{r.error}. Run it again to fill in the rest.</span>}
        </div>
      ),
    },
    { id: "created", header: "Vouchers", align: "right", cell: (r) => r.created.toLocaleString("en-PK") },
    { id: "skipped", header: "Skipped", align: "right", hideBelow: "sm", cell: (r) => r.skipped.toLocaleString("en-PK") },
    { id: "carried", header: "Carried forward", align: "right", hideBelow: "md", cell: (r) => (r.carried ? plural(r.carried, "balance") : "None") },
    { id: "billed", header: "Billed", align: "right", cell: (r) => <span className="font-medium tabular-nums">{rupees(r.totalBilled)}</span> },
  ];
  return (
    <Card padding="none" className="overflow-hidden">
      <div className="p-4 pb-0 sm:p-5 sm:pb-0">
        <CardHeader icon={<History />} title="Voucher runs" description="Each Generate vouchers press. Skipped students already had the month's voucher or had nothing to bill." />
      </div>
      <DataTable
        label="Voucher runs"
        columns={columns}
        data={runs.data}
        error={runs.error}
        onRetry={runs.reload}
        getRowId={(r) => r.id}
        pageSize={0}
        bare
        empty={{ icon: <History />, title: "No runs yet", description: "Runs appear here after vouchers are generated." }}
      />
    </Card>
  );
}
