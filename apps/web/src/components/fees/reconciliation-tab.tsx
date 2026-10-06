"use client";

import Link from "next/link";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { CircleAlert, CircleCheck, FileUp, RefreshCw, ScanSearch } from "lucide-react";
import { PROVIDER_LABEL, type OnlineProvider } from "@/components/invoices/online-payment";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  Dialog,
  KpiCard,
  NativeSelect,
  SelectField,
  StatGrid,
  TextareaField,
  useToast,
  type Column,
  type Tone,
} from "@/components/ui";
import { api } from "@/lib/api";
import { day, plural, rupees } from "@/lib/format";
import { readStatementFile } from "@/lib/statement-sheet";
import { useApi } from "@/lib/use-api";

/** Shapes of /fees/reconciliation (apps/api/src/fees/reconciliation). */
type IssueKind = "NEEDS_REVIEW" | "RECEIPT_MISMATCH" | "STILL_PENDING" | "NOT_IN_STATEMENT" | "NOT_IN_BOOKS" | "AMOUNT_MISMATCH";
type DayStatus = "RUNNING" | "CLEAN" | "ISSUES" | "FAILED";
type Count = { count: number; amount: number };

interface ReconDay {
  date: string;
  status: DayStatus;
  checked: number;
  settled: number;
  openIssues: number;
  totals: Partial<Record<OnlineProvider, { books: Count; statement: Count | null }>>;
  trigger: string;
  error: string | null;
}
interface Overview {
  mode: "mock" | "sandbox" | "live" | "off";
  openIssues: number;
  openByKind: Partial<Record<IssueKind, Count>>;
  days: ReconDay[];
  statements: { id: string; provider: OnlineProvider; fileName: string; fromDate: string; toDate: string; rows: number; matched: number; createdAt: string }[];
}
interface Issue {
  id: string;
  date: string;
  kind: IssueKind;
  provider: OnlineProvider;
  status: "OPEN" | "RESOLVED";
  reference: string;
  amount: number | null;
  detail: string;
  note: string | null;
  checkout: { id: string; invoiceId: string; voucherNo: string; student: string; admissionNo: string } | null;
}

const KIND_LABEL: Record<IssueKind, string> = {
  NEEDS_REVIEW: "Held for review",
  RECEIPT_MISMATCH: "Receipt mismatch",
  STILL_PENDING: "Gateway not confirmed",
  NOT_IN_STATEMENT: "Not on statement",
  NOT_IN_BOOKS: "No receipt for money",
  AMOUNT_MISMATCH: "Amount differs",
};
const KIND_TONE: Record<IssueKind, Tone> = {
  NEEDS_REVIEW: "warning",
  RECEIPT_MISMATCH: "danger",
  STILL_PENDING: "neutral",
  NOT_IN_STATEMENT: "danger",
  NOT_IN_BOOKS: "danger",
  AMOUNT_MISMATCH: "danger",
};
const DAY_LABEL: Record<DayStatus, string> = { RUNNING: "Running", CLEAN: "All matched", ISSUES: "Needs attention", FAILED: "Could not run" };
const DAY_TONE: Record<DayStatus, Tone> = { RUNNING: "info", CLEAN: "success", ISSUES: "warning", FAILED: "danger" };
const PROVIDERS = Object.keys(PROVIDER_LABEL) as OnlineProvider[];

const yesterday = () => {
  const d = new Date(Date.now() - 86_400_000);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
};

/**
 * Every night the server checks the day's online payments against the
 * gateways; this tab shows each day's result and what needs a person.
 */
export function ReconciliationTab() {
  const toast = useToast();
  const overview = useApi<Overview>("/fees/reconciliation");
  const [status, setStatus] = useState<"OPEN" | "RESOLVED">("OPEN");
  const issues = useApi<Issue[]>(`/fees/reconciliation/issues?status=${status}`);
  const [runDate, setRunDate] = useState(yesterday());
  const [running, setRunning] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [resolving, setResolving] = useState<Issue | null>(null);
  const data = overview.data;
  const loading = !data && !overview.error;
  const reload = async () => {
    await Promise.all([overview.reload(), issues.reload()]);
  };

  async function runNow() {
    setRunning(true);
    try {
      const r = await api<ReconDay>("/fees/reconciliation/run", { method: "POST", body: { date: runDate } });
      toast.success(
        r.openIssues ? "Reconciled with issues" : "Everything matched",
        `${day(runDate)}: ${plural(r.checked, "checkout")} checked${r.settled ? `, ${r.settled} settled with the gateway` : ""}.`,
      );
      await reload();
    } catch (e) {
      toast.error("Could not reconcile", (e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const dayColumns: Column<ReconDay>[] = [
    { id: "date", header: "Day", sortValue: (d) => d.date, cell: (d) => <span className="font-medium text-fg">{day(d.date)}</span> },
    {
      id: "status",
      header: "Result",
      sortValue: (d) => d.status,
      cell: (d) => (
        <div className="flex flex-col items-start gap-0.5">
          <Badge tone={DAY_TONE[d.status]}>{d.status === "ISSUES" ? plural(d.openIssues, "issue") : DAY_LABEL[d.status]}</Badge>
          {d.error && <span className="max-w-64 text-xs text-fg-muted">{d.error}</span>}
        </div>
      ),
    },
    {
      id: "books",
      header: "Receipts",
      align: "right",
      cell: (d) => rupees(Object.values(d.totals).reduce((s, t) => s + (t?.books.amount ?? 0), 0)),
    },
    {
      id: "statement",
      header: "Gateway statements",
      hideBelow: "md",
      cell: (d) => {
        const lines = PROVIDERS.filter((p) => d.totals[p]?.statement).map((p) => `${PROVIDER_LABEL[p]} ${rupees(d.totals[p]!.statement!.amount)}`);
        return lines.length ? <span className="text-fg-secondary">{lines.join(", ")}</span> : <span className="text-fg-muted">Not uploaded</span>;
      },
    },
    { id: "checked", header: "Checkouts", align: "right", hideBelow: "lg", sortValue: (d) => d.checked, cell: (d) => d.checked },
  ];

  const issueColumns: Column<Issue>[] = [
    { id: "date", header: "Day", sortValue: (i) => i.date, cell: (i) => day(i.date), hideBelow: "sm" },
    {
      id: "kind",
      header: "Issue",
      sortValue: (i) => i.kind,
      cell: (i) => (
        <div className="flex min-w-0 flex-col items-start gap-1">
          <Badge tone={i.status === "RESOLVED" ? "neutral" : KIND_TONE[i.kind]}>{KIND_LABEL[i.kind]}</Badge>
          <span className="max-w-96 text-xs text-fg-secondary">{i.detail}</span>
          {i.note && <span className="max-w-96 text-xs text-fg-muted">Resolved: {i.note}</span>}
        </div>
      ),
    },
    {
      id: "who",
      header: "Voucher",
      hideBelow: "md",
      cell: (i) =>
        i.checkout ? (
          <div className="min-w-0">
            <Link className="font-medium text-fg hover:text-brand" href={`/fees/invoices/${i.checkout.invoiceId}`}>
              {i.checkout.student}
            </Link>
            <div className="font-mono text-xs text-fg-muted">{i.checkout.voucherNo}</div>
          </div>
        ) : (
          <span className="text-fg-muted">Unknown</span>
        ),
    },
    {
      id: "ref",
      header: "Gateway",
      hideBelow: "lg",
      cell: (i) => (
        <div>
          <div>{PROVIDER_LABEL[i.provider]}</div>
          <div className="font-mono text-xs text-fg-muted">{i.reference}</div>
        </div>
      ),
    },
    { id: "amount", header: "Amount", align: "right", sortValue: (i) => i.amount ?? 0, cell: (i) => (i.amount == null ? "" : rupees(i.amount)) },
    {
      id: "action",
      header: <span className="sr-only">Action</span>,
      align: "right",
      cell: (i) =>
        i.status === "OPEN" ? (
          <Button size="sm" variant="secondary" onClick={() => setResolving(i)}>
            Resolve
          </Button>
        ) : null,
    },
  ];

  const moneyAtRisk = (["NOT_IN_BOOKS", "NOT_IN_STATEMENT", "AMOUNT_MISMATCH", "NEEDS_REVIEW"] as IssueKind[]).reduce(
    (s, k) => s + (data?.openByKind[k]?.amount ?? 0),
    0,
  );

  return (
    <div className="flex flex-col gap-6">
      {data?.mode === "mock" && (
        <Alert tone="info" title="Checking sandbox payments">
          Reconciliation runs every night at 2am on sandbox payments too, so you can try it. Upload a statement here to match it
          against the receipts.
        </Alert>
      )}
      <StatGrid cols={3}>
        <KpiCard
          label="Open issues"
          value={(data?.openIssues ?? 0).toLocaleString("en-PK")}
          icon={data?.openIssues ? <CircleAlert /> : <CircleCheck />}
          tone={data?.openIssues ? "danger" : "success"}
          loading={loading}
        />
        <KpiCard label="Money in question" value={rupees(moneyAtRisk)} hint="On open issues" icon={<ScanSearch />} tone="warning" loading={loading} />
        <KpiCard
          label="Last checked"
          value={data?.days[0] ? day(data.days[0].date) : "Not yet"}
          hint={data?.days[0] ? DAY_LABEL[data.days[0].status] : "Runs nightly once parents pay online"}
          icon={<RefreshCw />}
          tone="neutral"
          loading={loading}
        />
      </StatGrid>

      <DataTable
        label="Reconciliation issues"
        columns={issueColumns}
        data={issues.data}
        error={issues.error}
        onRetry={issues.reload}
        getRowId={(i) => i.id}
        getSearchText={(i) => `${i.reference} ${i.detail} ${i.checkout?.student ?? ""} ${i.checkout?.voucherNo ?? ""}`}
        searchPlaceholder="Search reference, student or voucher"
        defaultSort={{ id: "date", dir: "desc" }}
        filtered={status !== "OPEN"}
        toolbarActions={
          <NativeSelect
            aria-label="Issue status"
            value={status}
            onChange={(e) => setStatus(e.target.value as "OPEN" | "RESOLVED")}
            options={[
              { value: "OPEN", label: "Open" },
              { value: "RESOLVED", label: "Resolved" },
            ]}
          />
        }
        empty={{
          icon: <CircleCheck />,
          title: status === "OPEN" ? "Nothing to look at" : "No resolved issues",
          description: "Online payments that agree with the gateways need nothing from you.",
        }}
      />

      <Card padding="none" className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 p-4 pb-0 sm:p-5 sm:pb-0">
          <CardHeader title="Daily checks" description="Each night the server asks the gateways about open checkouts and checks the day's receipts." />
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              aria-label="Day to reconcile"
              value={runDate}
              max={yesterday()}
              onChange={(e) => setRunDate(e.target.value)}
              className="h-8 rounded-lg border border-border bg-surface px-2 text-sm"
            />
            <Button size="sm" variant="secondary" icon={<RefreshCw />} loading={running} onClick={runNow}>
              Check again
            </Button>
            <Button size="sm" icon={<FileUp />} onClick={() => setUploadOpen(true)}>
              Upload statement
            </Button>
          </div>
        </div>
        <DataTable
          label="Daily reconciliation"
          columns={dayColumns}
          data={data?.days ?? null}
          error={overview.error}
          onRetry={overview.reload}
          getRowId={(d) => d.date}
          defaultSort={{ id: "date", dir: "desc" }}
          pageSize={10}
          empty={{ icon: <ScanSearch />, title: "No checks yet", description: "The first check runs the night after a parent pays online." }}
        />
      </Card>

      {data && data.statements.length > 0 && (
        <Card>
          <CardHeader title="Uploaded statements" />
          <ul className="-mx-1 divide-y divide-border text-sm">
            {data.statements.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-1 py-2">
                <span className="min-w-0">
                  <span className="font-medium text-fg">{PROVIDER_LABEL[s.provider]}</span>{" "}
                  <span className="text-fg-muted">
                    {day(s.fromDate)}
                    {s.toDate !== s.fromDate && ` to ${day(s.toDate)}`} · {s.fileName}
                  </span>
                </span>
                <span className="text-fg-secondary">
                  {s.matched} of {plural(s.rows, "line")} matched
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <StatementDialog open={uploadOpen} onOpenChange={setUploadOpen} onDone={reload} />
      <ResolveDialog issue={resolving} onClose={() => setResolving(null)} onDone={reload} />
    </div>
  );
}

function StatementDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [provider, setProvider] = useState<OnlineProvider>("JAZZCASH");
  const [file, setFile] = useState<{ name: string; grid: string[][] } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setError("");
    setFile(null);
    if (!f) return;
    try {
      setFile({ name: f.name, grid: await readStatementFile(f) });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return setError("Choose the statement file.");
    setBusy(true);
    try {
      const r = await api<{ rows: number; matched: number; skipped: number; errorCount: number; openIssues: number; fromDate: string; toDate: string }>(
        "/fees/reconciliation/statements",
        { method: "POST", body: { provider, fileName: file.name, grid: file.grid } },
      );
      const unread = r.errorCount ? ` ${plural(r.errorCount, "row")} could not be read.` : "";
      toast.success(
        r.openIssues ? `${plural(r.openIssues, "issue")} to look at` : "Statement matches the receipts",
        `${r.matched} of ${plural(r.rows, "payment")} matched for ${day(r.fromDate)}${r.toDate !== r.fromDate ? ` to ${day(r.toDate)}` : ""}.${unread}`,
      );
      setFile(null);
      onOpenChange(false);
      await onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Upload a gateway statement"
      description="Download the transaction report from the merchant portal as CSV or Excel. Every successful payment on it is matched against the receipts, and anything that disagrees is listed here."
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="upload-statement" loading={busy} icon={<FileUp />}>
            Match statement
          </Button>
        </>
      }
    >
      <form id="upload-statement" onSubmit={submit} className="flex flex-col gap-4">
        <SelectField
          label="Gateway"
          value={provider}
          onChange={(e) => setProvider(e.target.value as OnlineProvider)}
          options={PROVIDERS.map((p) => ({ value: p, label: PROVIDER_LABEL[p] }))}
        />
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-[13px] font-medium text-fg-secondary">Statement file</span>
          <input
            type="file"
            accept=".csv,.xlsx"
            onChange={onFile}
            disabled={busy}
            className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand file:px-4 file:py-2 file:text-white"
          />
          <span className="text-xs text-fg-muted">
            It needs the order or transaction reference, the amount and the date. Uploading the same days again replaces them.
          </span>
        </label>
        {file && <p className="text-sm text-fg-secondary">{plural(file.grid.length - 1, "row")} read from {file.name}.</p>}
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}

function ResolveDialog({ issue, onClose, onDone }: { issue: Issue | null; onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!issue) return;
    setBusy(true);
    try {
      await api(`/fees/reconciliation/issues/${issue.id}/resolve`, { method: "POST", body: { note } });
      toast.success("Issue resolved");
      setNote("");
      setError("");
      onClose();
      await onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={!!issue}
      onOpenChange={(o) => !o && onClose()}
      title={issue ? KIND_LABEL[issue.kind] : ""}
      description={issue?.detail}
      size="sm"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="resolve-issue" loading={busy}>
            Mark resolved
          </Button>
        </>
      }
    >
      <form id="resolve-issue" onSubmit={submit} className="flex flex-col gap-4">
        <TextareaField
          label="What did you find?"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Refunded to the parent from the Easypaisa portal on 6 Oct."
          required
          rows={3}
        />
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}
