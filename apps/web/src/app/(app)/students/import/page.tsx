"use client";

import Link from "next/link";
import { useState, type ChangeEvent } from "react";
import { Badge, Button, Card, ErrorText, Notice, PageTitle, rowClass, tableClass } from "@/components/ui";
import { api } from "@/lib/api";
import { plural } from "@/lib/format";
import { useSectionOptions } from "@/lib/sections";
import { hasRole, SETUP, useSession } from "@/lib/session";
import { downloadStudentTemplate, readStudentFile, type ReadResult } from "@/lib/student-sheet";

interface CheckResult {
  valid: number;
  invalid: number;
  imported: number;
  rows: { row: number; name: string; classSection: string; errors: string[] }[];
}

const PREVIEW = 50;

export default function ImportStudentsPage() {
  const user = useSession();
  const sections = useSectionOptions();
  const [file, setFile] = useState<{ name: string; read: ReadResult } | null>(null);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(0);

  if (!hasRole(user, SETUP)) return <ErrorText>Only school admins can import students.</ErrorText>;

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    if (!chosen) return;
    setError("");
    setCheck(null);
    setDone(0);
    setFile(null);
    setBusy(true);
    try {
      const read = await readStudentFile(chosen);
      setFile({ name: chosen.name, read });
      if (read.missing.length) return;
      if (!read.rows.length) throw new Error("The file has headers but no students under them.");
      setCheck(await api<CheckResult>("/students/import", { method: "POST", body: { rows: read.rows } }));
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
      const result = await api<CheckResult>("/students/import", {
        method: "POST",
        body: { rows: file.read.rows, commit: true },
      });
      setCheck(result);
      setDone(result.imported);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const problems = check?.rows.filter((r) => r.errors.length) ?? [];
  const ready = check?.rows.filter((r) => !r.errors.length) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageTitle action={<Link href="/students" className="text-sm text-brand">Back to students</Link>}>
        Import students from Excel
      </PageTitle>

      <Card>
        <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm">
          <li>
            <span className="font-medium">Get the template</span> and copy your students into it, one per row. Class and
            section must match the ones set up under Classes (for example &ldquo;{sections.options[0]?.label ?? "Grade 1 A"}&rdquo;).
            Leave Admission No empty to have numbers given out automatically.
            <div className="mt-2">
              <Button
                variant="ghost"
                onClick={() =>
                  downloadStudentTemplate(
                    sections.classes.flatMap((c) => c.sections.map((s) => [c.name, s.name])),
                  ).catch((e: Error) => setError(e.message))
                }
              >
                Download template (.xlsx)
              </Button>
            </div>
          </li>
          <li>
            <span className="font-medium">Choose the filled-in file.</span> Nothing is saved yet; every row is checked first.
            <div className="mt-2">
              <input
                type="file"
                accept=".xlsx,.csv"
                onChange={onFile}
                disabled={busy}
                aria-label="Student file"
                className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand file:px-4 file:py-2 file:text-white"
              />
            </div>
          </li>
          <li>
            <span className="font-medium">Fix any problems</span> in Excel and choose the file again. When every row is ready,
            import them all at once.
          </li>
        </ol>
      </Card>

      {busy && <p className="text-sm opacity-60">Working…</p>}
      <ErrorText>{error}</ErrorText>

      {file && file.read.missing.length > 0 && (
        <ErrorText>
          {file.name} has no {file.read.missing.join(", ")} column. Use the template&rsquo;s headers and choose the file again.
        </ErrorText>
      )}
      {file && file.read.ignored.length > 0 && (
        <p className="text-sm opacity-70">Skipped columns the import doesn&rsquo;t use: {file.read.ignored.join(", ")}.</p>
      )}

      {done > 0 && (
        <Card>
          <Notice>Imported {plural(done, "student")}. They are on the Students list with their guardians.</Notice>
          <div className="mt-3 flex gap-3">
            <Link href="/students" className="text-sm font-medium text-brand">Open students</Link>
          </div>
        </Card>
      )}

      {check && !done && (
        <Card>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{file?.name}</span>
              <Badge tone="green">{check.valid} ready</Badge>
              {check.invalid > 0 && <Badge tone="red">{plural(check.invalid, "row")} to fix</Badge>}
            </div>
            <Button onClick={onImport} disabled={busy || check.invalid > 0}>
              Import {plural(check.valid, "student")}
            </Button>
          </div>
          {check.invalid > 0 && (
            <p className="mb-3 text-sm opacity-70">
              Nothing will be imported until every row is fixed, so a class is never left half done.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead className="opacity-60">
                <tr><th className="py-2">Row</th><th>Student</th><th>Class</th><th>Status</th></tr>
              </thead>
              <tbody>
                {[...problems, ...ready.slice(0, PREVIEW)].map((r) => (
                  <tr key={r.row} className={`${rowClass} align-top`}>
                    <td className="py-2 font-mono text-xs">{r.row}</td>
                    <td>{r.name || "–"}</td>
                    <td>{r.classSection || "–"}</td>
                    <td className="py-2">
                      {r.errors.length ? (
                        <ul className="text-red-600">{r.errors.map((e) => <li key={e}>{e}</li>)}</ul>
                      ) : (
                        <Badge tone="green">Ready</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {ready.length > PREVIEW && (
              <p className="pt-3 text-sm opacity-60">and {plural(ready.length - PREVIEW, "more ready row")}.</p>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
