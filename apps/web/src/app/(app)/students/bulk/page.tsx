"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, ErrorText, IconButton, Input, NativeSelect } from "@/components/ui";
import { api } from "@/lib/api";
import { emptyRow, errorsByLine, toImportRows, type BulkRow } from "@/lib/bulk-students";
import { plural } from "@/lib/format";
import { useSectionOptions } from "@/lib/sections";
import { hasRole, SETUP, useSession } from "@/lib/session";

interface CheckResult {
  valid: number;
  invalid: number;
  warned?: number;
  imported: number;
  rows: { row: number; name: string; errors: string[]; warnings?: string[] }[];
}

const GENDERS = [
  { value: "Male", label: "Boy" },
  { value: "Female", label: "Girl" },
];
const RELATIONS = ["Father", "Mother", "Guardian"].map((r) => ({ value: r, label: r }));

export default function BulkStudentsPage() {
  const user = useSession();
  const sections = useSectionOptions({ campusScoped: true });
  const [rows, setRows] = useState<BulkRow[]>(() => Array.from({ length: 5 }, () => emptyRow()));
  const [lines, setLines] = useState<ReturnType<typeof errorsByLine>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(0);

  if (!hasRole(user, SETUP)) return <ErrorText>Only school admins can add students.</ErrorText>;

  const names = (id: string) => {
    const cls = sections.classes.find((c) => c.sections.some((s) => s.id === id));
    const section = cls?.sections.find((s) => s.id === id);
    return cls && section ? { campus: cls.campus.name, class: cls.name, section: section.name } : undefined;
  };
  const set = (i: number, patch: Partial<BulkRow>) => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  // A new line starts from the one above, so a class (or a family of siblings) is quick to type.
  const addLine = (from: BulkRow) => setRows((all) => [...all, emptyRow(from)]);

  async function submit(commit: boolean) {
    const { sent, rowOf } = toImportRows(rows, names);
    if (!sent.length) return setError("Fill in at least one student.");
    setBusy(true);
    setError("");
    setSaved(0);
    try {
      const result = await api<CheckResult>("/students/import", { method: "POST", body: { rows: sent, commit, confirmWarnings: commit } });
      const found = errorsByLine(result.rows, rowOf);
      setLines(found);
      if (result.invalid) setError(`${plural(result.invalid, "line")} need fixing before anything is saved.`);
      else if (commit) {
        setSaved(result.imported);
        setRows(Array.from({ length: 5 }, () => emptyRow()));
        setLines(new Map());
      } else if (!result.warned) setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const filled = rows.filter((r) => r.firstName.trim()).length;
  const cell = "p-1 align-top";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-fg">Add several students</h1>
        <div className="flex gap-3 text-sm">
          <Link href="/students/import" className="text-brand">Import from Excel instead</Link>
          <Link href="/students" className="text-brand">Back to students</Link>
        </div>
      </div>

      <Card className="overflow-x-auto">
        <p className="mb-3 text-sm text-fg-secondary">
          One line per student. Use the copy button for a brother or sister: it keeps the class and the parent&apos;s details. Every line is checked
          the same way as an Excel import, and nothing is saved until all lines are right.
        </p>
        <table className="w-full min-w-[60rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-fg-muted">
              <th className="p-1">#</th>
              <th className="p-1">Class</th>
              <th className="p-1">First name</th>
              <th className="p-1">Last name</th>
              <th className="p-1">Boy / girl</th>
              <th className="p-1">Date of birth</th>
              <th className="p-1">Parent</th>
              <th className="p-1">Relation</th>
              <th className="p-1">Parent mobile</th>
              <th className="p-1"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const problem = lines.get(i);
              return (
                <Fragment key={i}>
                  <tr className={problem?.errors.length ? "bg-danger-bg/40" : undefined}>
                    <td className={`${cell} pt-2.5 text-fg-muted tabular-nums`}>{i + 1}</td>
                    <td className={cell}>
                      <NativeSelect aria-label={`Class, line ${i + 1}`} placeholder="Class" value={r.sectionId} onChange={(e) => set(i, { sectionId: e.target.value })} options={sections.options} wrapperClassName="w-36" />
                    </td>
                    <td className={cell}><Input aria-label={`First name, line ${i + 1}`} value={r.firstName} onChange={(e) => set(i, { firstName: e.target.value })} className="w-32" /></td>
                    <td className={cell}><Input aria-label={`Last name, line ${i + 1}`} value={r.lastName} onChange={(e) => set(i, { lastName: e.target.value })} className="w-28" /></td>
                    <td className={cell}>
                      <NativeSelect aria-label={`Boy or girl, line ${i + 1}`} placeholder="-" value={r.gender} onChange={(e) => set(i, { gender: e.target.value })} options={GENDERS} wrapperClassName="w-24" />
                    </td>
                    <td className={cell}><Input aria-label={`Date of birth, line ${i + 1}`} placeholder="21/03/2015" value={r.dateOfBirth} onChange={(e) => set(i, { dateOfBirth: e.target.value })} className="w-28" /></td>
                    <td className={cell}><Input aria-label={`Parent name, line ${i + 1}`} value={r.guardianName} onChange={(e) => set(i, { guardianName: e.target.value })} className="w-36" /></td>
                    <td className={cell}>
                      <NativeSelect aria-label={`Relation, line ${i + 1}`} value={r.guardianRelation} onChange={(e) => set(i, { guardianRelation: e.target.value })} options={RELATIONS} wrapperClassName="w-28" />
                    </td>
                    <td className={cell}><Input aria-label={`Parent mobile, line ${i + 1}`} inputMode="tel" placeholder="0300 1234567" value={r.guardianPhone} onChange={(e) => set(i, { guardianPhone: e.target.value })} className="w-36" /></td>
                    <td className={`${cell} whitespace-nowrap`}>
                      <IconButton size="sm" aria-label={`Add a brother or sister of line ${i + 1}`} onClick={() => addLine(r)}><Copy className="size-4" aria-hidden /></IconButton>
                      <IconButton size="sm" aria-label={`Remove line ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows((all) => all.filter((_, j) => j !== i))}><Trash2 className="size-4" aria-hidden /></IconButton>
                    </td>
                  </tr>
                  {problem && (
                    <tr>
                      <td />
                      <td colSpan={9} className="pb-2 text-xs">
                        {problem.errors.map((e) => <p key={e} className="text-danger-text">{e}</p>)}
                        {problem.warnings.map((w) => <p key={w} className="text-warning-text">{w}</p>)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="sm" icon={<Plus />} onClick={() => setRows((all) => [...all, ...Array.from({ length: 5 }, () => emptyRow(all.at(-1)))])}>
            Add 5 lines
          </Button>
          <Badge tone="neutral">{plural(filled, "student")} filled in</Badge>
        </div>
      </Card>

      {error && <Alert tone="danger">{error}</Alert>}
      {saved > 0 && <Alert tone="success">{plural(saved, "student")} added. Admission numbers were given out automatically.</Alert>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" loading={busy} onClick={() => submit(false)}>Check lines</Button>
        <Button type="button" loading={busy} disabled={!filled} onClick={() => submit(true)}>Add {filled ? plural(filled, "student") : "students"}</Button>
      </div>
    </div>
  );
}
