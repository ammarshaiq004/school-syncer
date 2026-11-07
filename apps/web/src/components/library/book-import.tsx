"use client";

import { useState, type ChangeEvent } from "react";
import { FileSpreadsheet } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, ErrorText, NativeSelect } from "@/components/ui";
import { api } from "@/lib/api";
import { plural } from "@/lib/format";
import { downloadBookTemplate, readBookFile, type BookReadResult } from "@/lib/book-sheet";
import { campusScope, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

interface CheckResult {
  valid: number;
  invalid: number;
  warned: number;
  imported: number;
  copies: number;
  needsConfirmation?: boolean;
  rows: { row: number; title: string; errors: string[]; warnings: string[] }[];
}

const PREVIEW = 50;

/** Adds many books at once from an Excel sheet; every row is checked before anything is saved. */
export function BookImport({ onChange }: { onChange: () => Promise<void> }) {
  const user = useSession();
  const campuses = useApi<{ id: string; name: string }[]>("/campuses");
  const [campusId, setCampusId] = useState("");
  const [file, setFile] = useState<{ name: string; read: BookReadResult } | null>(null);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ titles: number; copies: number } | null>(null);
  // Campus staff must say which campus the new copies belong to; school-wide staff may leave it empty.
  const mustPick = campusScope(user) !== null;
  const shown = (campuses.data ?? []).filter((c) => !mustPick || (campusScope(user) ?? []).includes(c.id));

  const send = (rows: BookReadResult["rows"], extra: object = {}) =>
    api<CheckResult>("/library/books/import", { method: "POST", body: { rows, campusId: campusId || null, ...extra } });

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    if (!chosen) return;
    setError("");
    setCheck(null);
    setDone(null);
    setFile(null);
    setBusy(true);
    try {
      const read = await readBookFile(chosen);
      setFile({ name: chosen.name, read });
      if (read.missing.length) return;
      if (!read.rows.length) throw new Error("The file has headers but no books under them.");
      setCheck(await send(read.rows));
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
      // The warnings were on screen next to the button, so importing confirms them.
      const result = await send(file.read.rows, { commit: true, confirmWarnings: true });
      setCheck(result);
      setDone({ titles: result.imported, copies: result.copies });
      await onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const problems = check?.rows.filter((r) => r.errors.length) ?? [];
  const warned = check?.rows.filter((r) => !r.errors.length && r.warnings.length) ?? [];

  return (
    <Card className="max-w-3xl">
      <CardHeader title="Add books from Excel" icon={<FileSpreadsheet />} description="Copy your accession register into the template. Each row is a title; Copies says how many numbered copies to create." />
      <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm">
        <li>
          <span className="font-medium">Get the template.</span> A title already in the catalogue (same ISBN, or same title and author) gets the extra copies instead of a second entry.
          <div className="mt-2">
            <Button variant="ghost" onClick={() => downloadBookTemplate().catch((e: Error) => setError(e.message))}>Download template (.xlsx)</Button>
          </div>
        </li>
        {shown.length > 1 || mustPick ? (
          <li>
            <span className="font-medium">Choose the campus</span> the new copies are shelved at.
            <div className="mt-2">
              <NativeSelect aria-label="Campus" placeholder={mustPick ? "Choose campus" : "Whole school"} value={campusId} onChange={(e) => setCampusId(e.target.value)} options={shown.map((c) => ({ value: c.id, label: c.name }))} wrapperClassName="w-60" />
            </div>
          </li>
        ) : null}
        <li>
          <span className="font-medium">Choose the filled-in file.</span> Nothing is saved yet; every row is checked first.
          <div className="mt-2">
            <input type="file" accept=".xlsx,.csv" onChange={onFile} disabled={busy || (mustPick && !campusId)} aria-label="Book file" className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand file:px-4 file:py-2 file:text-white" />
          </div>
        </li>
      </ol>

      {error && <div className="mt-4"><ErrorText>{error}</ErrorText></div>}
      {file?.read.missing.length ? <div className="mt-4"><Alert tone="danger">The file has no {file.read.missing.join(", ")} column.</Alert></div> : null}
      {file && file.read.ignored.length > 0 && <p className="mt-3 text-xs text-fg-muted">Ignored columns: {file.read.ignored.join(", ")}</p>}

      {check && !done && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="success">{plural(check.valid, "book row")} ready</Badge>
            {check.invalid > 0 && <Badge tone="danger">{plural(check.invalid, "row")} to fix</Badge>}
            {warned.length > 0 && <Badge tone="warning">{plural(warned.length, "row")} already in the catalogue</Badge>}
          </div>
          {problems.length > 0 && (
            <Alert tone="danger" title="Fix these rows in your file, then choose it again">
              <ul className="list-disc pl-5">
                {problems.slice(0, PREVIEW).map((r) => (
                  <li key={r.row}>Row {r.row}{r.title ? ` (${r.title})` : ""}: {r.errors.join("; ")}</li>
                ))}
              </ul>
              {problems.length > PREVIEW && <p className="mt-1">…and {problems.length - PREVIEW} more.</p>}
            </Alert>
          )}
          {warned.length > 0 && problems.length === 0 && (
            <Alert tone="warning" title="These titles exist already; their copies will be added to the existing book">
              <ul className="list-disc pl-5">
                {warned.slice(0, PREVIEW).map((r) => <li key={r.row}>Row {r.row}: {r.title}</li>)}
              </ul>
            </Alert>
          )}
          {problems.length === 0 && (
            <div className="flex justify-end border-t border-border pt-3">
              <Button type="button" loading={busy} onClick={onImport}>Import {plural(check.valid, "row")}</Button>
            </div>
          )}
        </div>
      )}
      {done && <div className="mt-4"><Alert tone="success">Added {plural(done.copies, "copy")} across {plural(done.titles, "title")}. Print barcode labels for them in the Labels tab.</Alert></div>}
    </Card>
  );
}
