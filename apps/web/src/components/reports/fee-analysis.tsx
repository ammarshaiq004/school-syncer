"use client";

import Link from "next/link";
import { useState } from "react";
import { Download, Users, Wallet } from "lucide-react";
import { DateRange } from "@/components/date-range";
import { Button, Card, CardHeader, DataTable, KpiCard, SelectField, StatGrid, StatusPill, type Column } from "@/components/ui";
import { ReportBody, Totals, type Total } from "@/components/reports/shared";
import { downloadCsv } from "@/lib/csv";
import { day, rupees, thisMonth, todayIso } from "@/lib/format";
import { useApi } from "@/lib/use-api";

const SUB = {
  discounts: "Discounts",
  advance: "Advance fee",
  multi: "Months owed",
  families: "Family fees",
  structure: "Fee structure",
  installments: "Instalments",
} as const;
type Sub = keyof typeof SUB;

const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/** Fee reports: discounts, advance fees, months owed, families, structure and instalments. */
export function FeeAnalysis() {
  const [sub, setSub] = useState<Sub>("discounts");
  const [range, setRange] = useState({ from: `${thisMonth()}-01`, to: todayIso() });
  const dated = sub === "discounts" || sub === "advance" || sub === "installments";
  return (
    <div className="flex flex-col gap-6 pt-5">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <SelectField
          label="Report"
          value={sub}
          onChange={(e) => setSub(e.target.value as Sub)}
          options={(Object.keys(SUB) as Sub[]).map((k) => ({ value: k, label: SUB[k] }))}
        />
        {dated && <DateRange from={range.from} to={range.to} onChange={setRange} />}
      </div>
      {sub === "discounts" && <Discounts range={range} />}
      {sub === "advance" && <Advance range={range} />}
      {sub === "multi" && <MultiMonth />}
      {sub === "families" && <Families />}
      {sub === "structure" && <Structure />}
      {sub === "installments" && <Installments range={range} />}
    </div>
  );
}

type Range = { from: string; to: string };

function Download_({ name, header, rows }: { name: string; header: string[]; rows: (string | number)[][] }) {
  return (
    <Button variant="secondary" size="sm" icon={<Download />} disabled={!rows.length} className="print:hidden" onClick={() => downloadCsv(name, header, rows)}>
      Download for Excel
    </Button>
  );
}

function Discounts({ range }: { range: Range }) {
  const report = useApi<{
    total: number;
    count: number;
    truncated: boolean;
    byKind: Total[];
    rows: { voucherNo: string; period: string; student: string; admissionNo: string; kind: string; description: string; reason: string | null; amount: number }[];
  }>(`/reports/fees/discounts?from=${range.from}&to=${range.to}`);
  return (
    <ReportBody report={report} kpis={2}>
      {(r) => (
        <>
          <StatGrid cols={2}>
            <KpiCard label="Discounts given" value={rupees(r.total)} icon={<Wallet />} tone="warning" hint="On vouchers issued in these dates" />
            <KpiCard label="Discount lines" value={r.count.toLocaleString("en-PK")} icon={<Users />} />
          </StatGrid>
          <Card>
            <CardHeader title="By kind" />
            <Totals rows={r.byKind} tone="warning" empty="No discounts in these dates." />
          </Card>
          <DataTable
            label="Discounts given"
            data={r.rows}
            getRowId={(x) => `${x.voucherNo}|${x.description}`}
            getSearchText={(x) => `${x.student} ${x.admissionNo} ${x.voucherNo} ${x.kind}`}
            defaultSort={{ id: "amount", dir: "desc" }}
            toolbarActions={<Download_ name="discounts.csv" header={["Voucher", "Month", "Admission no.", "Student", "Kind", "Description", "Reason", "Amount"]} rows={r.rows.map((x) => [x.voucherNo, x.period, x.admissionNo, x.student, x.kind, x.description, x.reason ?? "", x.amount])} />}
            columns={[
              { id: "student", header: "Student", sortValue: (x) => x.student, cell: (x) => <div><div className="font-medium text-fg">{x.student}</div><div className="text-xs text-fg-muted">{x.admissionNo}</div></div> },
              { id: "kind", header: "Kind", sortValue: (x) => x.kind, cell: (x) => x.kind },
              { id: "what", header: "Line", hideBelow: "md", cell: (x) => <span>{x.description}{x.reason ? <span className="text-fg-muted">, {x.reason}</span> : null}</span> },
              { id: "voucher", header: "Voucher", hideBelow: "sm", cell: (x) => x.voucherNo },
              { id: "amount", header: "Amount", align: "right", sortValue: (x) => x.amount, cell: (x) => rupees(x.amount) },
            ] satisfies Column<(typeof r.rows)[number]>[]}
            empty={{ icon: <Wallet />, title: "No discounts in these dates" }}
          />
          {r.truncated && <p className="text-xs text-fg-muted">Showing the 500 largest. The totals above cover all {r.count}.</p>}
        </>
      )}
    </ReportBody>
  );
}

function Advance({ range }: { range: Range }) {
  const report = useApi<{
    total: number;
    count: number;
    truncated: boolean;
    rows: { receiptNo: string; receivedOn: string; voucherNo: string; period: string; student: string; admissionNo: string; amount: number }[];
  }>(`/reports/fees/advance?from=${range.from}&to=${range.to}`);
  return (
    <ReportBody report={report} kpis={2}>
      {(r) => (
        <>
          <StatGrid cols={2}>
            <KpiCard label="Paid in advance" value={rupees(r.total)} icon={<Wallet />} tone="success" hint="Received before the voucher's month" />
            <KpiCard label="Receipts" value={r.count.toLocaleString("en-PK")} icon={<Users />} />
          </StatGrid>
          <DataTable
            label="Advance fee receipts"
            data={r.rows}
            getRowId={(x) => x.receiptNo}
            getSearchText={(x) => `${x.student} ${x.admissionNo} ${x.voucherNo} ${x.receiptNo}`}
            toolbarActions={<Download_ name="advance-fees.csv" header={["Receipt", "Received", "Voucher", "Month", "Admission no.", "Student", "Amount"]} rows={r.rows.map((x) => [x.receiptNo, x.receivedOn, x.voucherNo, x.period, x.admissionNo, x.student, x.amount])} />}
            columns={[
              { id: "student", header: "Student", sortValue: (x) => x.student, cell: (x) => <div><div className="font-medium text-fg">{x.student}</div><div className="text-xs text-fg-muted">{x.admissionNo}</div></div> },
              { id: "period", header: "For month", sortValue: (x) => x.period, cell: (x) => x.period },
              { id: "received", header: "Received", hideBelow: "sm", sortValue: (x) => x.receivedOn, cell: (x) => day(x.receivedOn) },
              { id: "amount", header: "Amount", align: "right", sortValue: (x) => x.amount, cell: (x) => rupees(x.amount) },
            ] satisfies Column<(typeof r.rows)[number]>[]}
            empty={{ icon: <Wallet />, title: "No advance payments in these dates" }}
          />
          {r.truncated && <p className="text-xs text-fg-muted">Showing the latest 500. The totals above cover all {r.count}.</p>}
        </>
      )}
    </ReportBody>
  );
}

function MultiMonth() {
  const [min, setMin] = useState(2);
  const report = useApi<{
    students: number;
    total: number;
    rows: { studentId: string; student: string; admissionNo: string; months: number; periods: string[]; balance: number }[];
  }>(`/reports/fees/multi-month?min=${min}`);
  return (
    <>
      <SelectField label="Owing at least" value={min} onChange={(e) => setMin(Number(e.target.value))} options={[2, 3, 4, 6].map((n) => ({ value: String(n), label: `${n} months` }))} wrapperClassName="print:hidden w-40" />
      <ReportBody report={report} kpis={2}>
        {(r) => (
          <>
            <StatGrid cols={2}>
              <KpiCard label="Students" value={r.students.toLocaleString("en-PK")} icon={<Users />} tone="warning" />
              <KpiCard label="Owed by them" value={rupees(r.total)} icon={<Wallet />} tone="danger" />
            </StatGrid>
            <DataTable
              label="Students owing several months"
              data={r.rows}
              getRowId={(x) => x.studentId}
              getSearchText={(x) => `${x.student} ${x.admissionNo}`}
              defaultSort={{ id: "balance", dir: "desc" }}
              toolbarActions={<Download_ name="months-owed.csv" header={["Admission no.", "Student", "Months", "Which months", "Balance"]} rows={r.rows.map((x) => [x.admissionNo, x.student, x.months, x.periods.join(" "), x.balance])} />}
              columns={[
                { id: "student", header: "Student", sortValue: (x) => x.student, cell: (x) => <div><div className="font-medium text-fg">{x.student}</div><div className="text-xs text-fg-muted">{x.admissionNo}</div></div> },
                { id: "months", header: "Months", align: "right", sortValue: (x) => x.months, cell: (x) => x.months },
                { id: "which", header: "Which", hideBelow: "md", cell: (x) => x.periods.join(", ") },
                { id: "balance", header: "Balance", align: "right", sortValue: (x) => x.balance, cell: (x) => rupees(x.balance) },
              ] satisfies Column<(typeof r.rows)[number]>[]}
              empty={{ icon: <Users />, title: `Nobody owes ${min} or more months` }}
            />
          </>
        )}
      </ReportBody>
    </>
  );
}

function Families() {
  const [owing, setOwing] = useState(true);
  const report = useApi<{
    families: number;
    billed: number;
    paid: number;
    balance: number;
    rows: { familyId: string; guardians: string; phone: string; children: string[]; billed: number; paid: number; balance: number }[];
  }>(`/reports/fees/families?owing=${owing}`);
  return (
    <>
      <SelectField label="Show" value={owing ? "owing" : "all"} onChange={(e) => setOwing(e.target.value === "owing")} options={[{ value: "owing", label: "Families owing" }, { value: "all", label: "All families" }]} wrapperClassName="print:hidden w-48" />
      <ReportBody report={report} kpis={3}>
        {(r) => (
          <>
            <StatGrid cols={3}>
              <KpiCard label="Families" value={r.families.toLocaleString("en-PK")} icon={<Users />} />
              <KpiCard label="Billed" value={rupees(r.billed)} icon={<Wallet />} tone="info" />
              <KpiCard label="Still owed" value={rupees(r.balance)} icon={<Wallet />} tone="danger" />
            </StatGrid>
            <DataTable
              label="Fees by family"
              data={r.rows}
              getRowId={(x) => x.familyId}
              getSearchText={(x) => `${x.guardians} ${x.phone} ${x.children.join(" ")}`}
              defaultSort={{ id: "balance", dir: "desc" }}
              toolbarActions={<Download_ name="family-fees.csv" header={["Guardians", "Phone", "Children", "Billed", "Paid", "Balance"]} rows={r.rows.map((x) => [x.guardians, x.phone, x.children.join(", "), x.billed, x.paid, x.balance])} />}
              columns={[
                { id: "family", header: "Family", sortValue: (x) => x.guardians, cell: (x) => <div><div className="font-medium text-fg">{x.guardians || "No guardian"}</div><div className="text-xs text-fg-muted">{x.children.join(", ")}</div></div> },
                { id: "phone", header: "Phone", hideBelow: "md", cell: (x) => x.phone },
                { id: "billed", header: "Billed", align: "right", hideBelow: "sm", sortValue: (x) => x.billed, cell: (x) => rupees(x.billed) },
                { id: "paid", header: "Paid", align: "right", hideBelow: "sm", sortValue: (x) => x.paid, cell: (x) => rupees(x.paid) },
                { id: "balance", header: "Balance", align: "right", sortValue: (x) => x.balance, cell: (x) => <span className="font-medium text-fg">{rupees(x.balance)}</span> },
                { id: "open", header: "", align: "right", cell: (x) => <Link className="text-brand hover:underline print:hidden" href={`/fees/family/${x.familyId}`}>Voucher</Link> },
              ] satisfies Column<(typeof r.rows)[number]>[]}
              empty={{ icon: <Users />, title: "No families to show" }}
            />
          </>
        )}
      </ReportBody>
    </>
  );
}

function Structure() {
  const report = useApi<{
    year: { id: string; name: string } | null;
    classes: { classId: string; name: string; campus: string; students: number; heads: { name: string; frequency: string; amount: number }[]; perMonth: number; perYear: number; potentialYear: number; billed: number; collected: number; collectedPct: number }[];
    heads: Total[];
  }>("/reports/fees/structure");
  return (
    <ReportBody report={report} kpis={2}>
      {(r) =>
        !r.year ? (
          <p className="text-sm text-fg-muted">Set up an academic year and fee structure first.</p>
        ) : (
          <>
            <StatGrid cols={3}>
              <KpiCard label="Academic year" value={r.year.name} icon={<Users />} />
              <KpiCard label="Potential this year" value={rupees(r.classes.reduce((s, c) => s + c.potentialYear, 0))} icon={<Wallet />} tone="info" hint="Structure times students" />
              <KpiCard label="Collected so far" value={rupees(r.classes.reduce((s, c) => s + c.collected, 0))} icon={<Wallet />} tone="success" />
            </StatGrid>
            <Card>
              <CardHeader title="Potential by fee head" description="A year of the structure across all students" />
              <Totals rows={r.heads} tone="primary" empty="No fee structure yet." />
            </Card>
            <DataTable
              label="Fee structure by class"
              data={r.classes}
              getRowId={(c) => c.classId}
              getSearchText={(c) => `${c.name} ${c.campus}`}
              toolbarActions={<Download_ name="fee-structure.csv" header={["Campus", "Class", "Students", "Per month", "Per year", "Potential", "Billed", "Collected", "Collected %"]} rows={r.classes.map((c) => [c.campus, c.name, c.students, c.perMonth, c.perYear, c.potentialYear, c.billed, c.collected, c.collectedPct])} />}
              columns={[
                { id: "class", header: "Class", sortValue: (c) => c.name, cell: (c) => <div><div className="font-medium text-fg">{c.name}</div><div className="text-xs text-fg-muted">{c.heads.map((h) => `${h.name} ${rupees(h.amount)}`).join(", ")}</div></div> },
                { id: "students", header: "Students", align: "right", sortValue: (c) => c.students, cell: (c) => c.students },
                { id: "month", header: "Per month", align: "right", hideBelow: "md", sortValue: (c) => c.perMonth, cell: (c) => rupees(c.perMonth) },
                { id: "potential", header: "Potential", align: "right", sortValue: (c) => c.potentialYear, cell: (c) => rupees(c.potentialYear) },
                { id: "billed", header: "Billed", align: "right", hideBelow: "sm", sortValue: (c) => c.billed, cell: (c) => rupees(c.billed) },
                { id: "collected", header: "Collected", align: "right", sortValue: (c) => c.collected, cell: (c) => `${rupees(c.collected)} (${c.collectedPct}%)` },
              ] satisfies Column<(typeof r.classes)[number]>[]}
              empty={{ icon: <Wallet />, title: "No fee structure set for this year" }}
            />
          </>
        )
      }
    </ReportBody>
  );
}

function Installments({ range }: { range: Range }) {
  const report = useApi<{
    count: number;
    due: number;
    collected: number;
    overdue: number;
    rows: { invoiceId: string; voucherNo: string; student: string; admissionNo: string; seq: number; of: number; dueDate: string; amount: number; paid: number; balance: number; status: string }[];
  }>(`/reports/fees/installments?from=${range.from}&to=${range.to}`);
  const tone = (s: string) => (s === "PAID" ? "success" : s === "OVERDUE" ? "danger" : s === "PARTIAL" ? "warning" : "neutral");
  return (
    <ReportBody report={report} kpis={3}>
      {(r) => (
        <>
          <StatGrid cols={3}>
            <KpiCard label="Falling due" value={rupees(r.due)} icon={<Wallet />} tone="info" hint={`${r.count} instalments`} />
            <KpiCard label="Paid" value={rupees(r.collected)} icon={<Wallet />} tone="success" />
            <KpiCard label="Overdue" value={rupees(r.overdue)} icon={<Wallet />} tone="danger" />
          </StatGrid>
          <DataTable
            label="Instalments due"
            data={r.rows}
            getRowId={(x) => `${x.invoiceId}|${x.seq}`}
            getSearchText={(x) => `${x.student} ${x.admissionNo} ${x.voucherNo}`}
            defaultSort={{ id: "due", dir: "asc" }}
            toolbarActions={<Download_ name="instalments.csv" header={["Due", "Admission no.", "Student", "Voucher", "Instalment", "Amount", "Paid", "Balance", "Status"]} rows={r.rows.map((x) => [x.dueDate, x.admissionNo, x.student, x.voucherNo, `${x.seq} of ${x.of}`, x.amount, x.paid, x.balance, x.status])} />}
            columns={[
              { id: "due", header: "Due", sortValue: (x) => x.dueDate, cell: (x) => day(x.dueDate) },
              { id: "student", header: "Student", sortValue: (x) => x.student, cell: (x) => <div><Link className="font-medium text-fg hover:underline" href={`/fees/invoices/${x.invoiceId}`}>{x.student}</Link><div className="text-xs text-fg-muted">{x.admissionNo}, {x.voucherNo}</div></div> },
              { id: "n", header: "Instalment", hideBelow: "sm", cell: (x) => `${x.seq} of ${x.of}` },
              { id: "amount", header: "Amount", align: "right", sortValue: (x) => x.amount, cell: (x) => rupees(x.amount) },
              { id: "balance", header: "Balance", align: "right", hideBelow: "sm", sortValue: (x) => x.balance, cell: (x) => rupees(x.balance) },
              { id: "status", header: "Status", cell: (x) => <StatusPill status={x.status} tone={tone(x.status)} label={label(x.status)} /> },
            ] satisfies Column<(typeof r.rows)[number]>[]}
            empty={{ icon: <Wallet />, title: "No instalments fall due in these dates" }}
          />
        </>
      )}
    </ReportBody>
  );
}

