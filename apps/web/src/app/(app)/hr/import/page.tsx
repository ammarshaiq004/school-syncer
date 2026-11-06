"use client";

import Link from "next/link";
import { useState, type ChangeEvent } from "react";
import { Badge, Button, Card, ErrorText, Notice, PageTitle, rowClass, tableClass } from "@/components/ui";
import { api } from "@/lib/api";
import { csvCell } from "@/lib/csv";
import { plural } from "@/lib/format";
import { hasRole, SETUP, useSession } from "@/lib/session";
import { downloadStaffTemplate, readStaffFile, type StaffReadResult } from "@/lib/staff-sheet";

interface CheckResult {
  valid: number;
  invalid: number;
  imported: number;
  rows: { row: number; name: string; errors: string[] }[];
  logins: { name: string; employeeNo: string; login: string | null; temporaryPassword: string }[];
}

const PREVIEW = 50;

export default function ImportStaffPage() {
  const user = useSession();
  const [file, setFile] = useState<{ name: string; read: StaffReadResult } | null>(null);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!hasRole(user, SETUP)) return <ErrorText>Only school admins can import staff.</ErrorText>;

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    if (!chosen) return;
    setError("");
    setCheck(null);
    setFile(null);
    setBusy(true);
    try {
      const read = await readStaffFile(chosen);
      setFile({ name: chosen.name, read });
      if (read.missing.length) return;
      if (!read.rows.length) throw new Error("The file has headers but no staff under them.");
      setCheck(await api<CheckResult>("/hr/staff/import", { method: "POST", body: { rows: read.rows } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onImport() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      setCheck(await api<CheckResult>("/hr/staff/import", { method: "POST", body: { rows: file.read.rows, commit: true } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function downloadLogins() {
    if (!check) return;
    const csv = ["Name,Employee No,Login,Temporary password", ...check.logins.map((l) => [l.name, l.employeeNo, l.login ?? "", l.temporaryPassword].map(csvCell).join(","))].join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = "new-staff-logins.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const problems = check?.rows.filter((r) => r.errors.length) ?? [];
  const ready = check?.rows.filter((r) => !r.errors.length) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageTitle action={<Link href="/hr" className="text-sm text-brand">Back to HR</Link>}>Import staff from Excel or CSV</PageTitle>

      <Card>
        <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm">
          <li>
            <span className="font-medium">Get the template</span> and copy your staff into it, one per row. Each person needs a name, a designation and an email or mobile number.
            Role can be Teacher, Class Teacher or Staff (leave it empty for Teacher). Other roles are given under Users and roles.
            <div className="mt-2">
              <Button variant="ghost" onClick={() => downloadStaffTemplate().catch((e: Error) => setError(e.message))}>Download template (.xlsx)</Button>
            </div>
          </li>
          <li>
            <span className="font-medium">Choose the filled-in file.</span> Nothing is saved yet; every row is checked first.
            <div className="mt-2">
              <input type="file" accept=".xlsx,.csv" onChange={onFile} disabled={busy} aria-label="Staff file" className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand file:px-4 file:py-2 file:text-white" />
            </div>
          </li>
          <li>
            <span className="font-medium">Fix any problems</span> in Excel and choose the file again. When every row is ready, import them all at once. Each person gets a temporary password, shown once.
          </li>
        </ol>
      </Card>

      {busy && <p className="text-sm opacity-60">Working…</p>}
      <ErrorText>{error}</ErrorText>
      {file && file.read.missing.length > 0 && (
        <ErrorText>{file.name} has no {file.read.missing.join(", ")} column. Use the template&rsquo;s headers and choose the file again.</ErrorText>
      )}
      {file && file.read.ignored.length > 0 && <p className="text-sm opacity-70">Skipped columns the import doesn&rsquo;t use: {file.read.ignored.join(", ")}.</p>}

      {check && check.imported > 0 && (
        <Card>
          <Notice>Imported {plural(check.imported, "staff member")}. Hand each person their login now: the passwords are not shown again, and everyone must change theirs at first sign-in.</Notice>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button onClick={downloadLogins}>Download logins (.csv)</Button>
            <Link href="/hr" className="self-center text-sm font-medium text-brand">Open HR</Link>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className={tableClass}>
              <thead className="opacity-60"><tr><th className="py-2">Name</th><th>Emp. no.</th><th>Login</th><th>Temporary password</th></tr></thead>
              <tbody>
                {check.logins.map((l) => (
                  <tr key={l.employeeNo} className={rowClass}>
                    <td className="py-2">{l.name}</td><td>{l.employeeNo}</td><td>{l.login}</td><td className="font-mono text-xs">{l.temporaryPassword}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {check && !check.imported && (
        <Card>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{file?.name}</span>
              <Badge tone="green">{check.valid} ready</Badge>
              {check.invalid > 0 && <Badge tone="red">{plural(check.invalid, "row")} to fix</Badge>}
            </div>
            <Button onClick={onImport} disabled={busy || check.invalid > 0}>Import {plural(check.valid, "staff member")}</Button>
          </div>
          {check.invalid > 0 && <p className="mb-3 text-sm opacity-70">Nothing will be imported until every row is fixed.</p>}
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead className="opacity-60"><tr><th className="py-2">Row</th><th>Name</th><th>Status</th></tr></thead>
              <tbody>
                {[...problems, ...ready.slice(0, PREVIEW)].map((r) => (
                  <tr key={r.row} className={`${rowClass} align-top`}>
                    <td className="py-2 font-mono text-xs">{r.row}</td>
                    <td>{r.name || "–"}</td>
                    <td className="py-2">
                      {r.errors.length ? <ul className="text-red-600">{r.errors.map((e) => <li key={e}>{e}</li>)}</ul> : <Badge tone="green">Ready</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {ready.length > PREVIEW && <p className="pt-3 text-sm opacity-60">and {plural(ready.length - PREVIEW, "more ready row")}.</p>}
          </div>
        </Card>
      )}
    </div>
  );
}
