"use client";

import { useState, type FormEvent } from "react";
import { Printer, ScanBarcode } from "lucide-react";
import { Button, Card, CardHeader, EmptyState, ErrorState, Field, SkeletonRows } from "@/components/ui";
import { api } from "@/lib/api";
import { Barcode } from "./barcode";

interface Label {
  id: string;
  accessionNo: string;
  title: string;
  author: string | null;
  shelf: string | null;
  modules: string;
}

/** Barcode stickers for books: choose a range of book numbers or search a title, then print the sheet. */
export function BarcodeLabels() {
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [labels, setLabels] = useState<Label[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const q = new URLSearchParams();
      if (search.trim()) q.set("search", search.trim());
      if (from.trim()) q.set("from", from.trim());
      if (to.trim()) q.set("to", to.trim());
      setLabels(await api<Label[]>(`/library/labels?${q}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="print:hidden">
        <CardHeader title="Barcode labels" icon={<ScanBarcode />} description="Print a sticker for each book. Scan it at the desk instead of typing the number. Leave everything empty for every book (up to 500 at a time)." />
        <form onSubmit={load} className="grid gap-4 sm:grid-cols-4 sm:items-end">
          <Field label="Title or author" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Field label="From book number" type="number" min={1} value={from} onChange={(e) => setFrom(e.target.value)} />
          <Field label="To book number" type="number" min={1} value={to} onChange={(e) => setTo(e.target.value)} />
          <div className="flex gap-2">
            <Button type="submit" variant="secondary" loading={busy}>Show labels</Button>
            <Button type="button" icon={<Printer />} disabled={!labels?.length} onClick={() => window.print()}>Print</Button>
          </div>
        </form>
      </Card>
      {error ? (
        <ErrorState compact message={error} />
      ) : busy ? (
        <SkeletonRows rows={3} columns={1} />
      ) : labels && labels.length === 0 ? (
        <EmptyState icon={<ScanBarcode />} title="No books match" description="Check the book numbers, or add books to the catalogue first." />
      ) : labels ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-4 print:gap-2" aria-label="Labels">
          {labels.map((l) => (
            <li key={l.id} className="break-inside-avoid rounded-lg border border-border bg-white p-2 text-black print:rounded-none print:border-black">
              <p className="truncate text-[11px] font-semibold" title={l.title}>{l.title}</p>
              <Barcode modules={l.modules} label={`Barcode for book ${l.accessionNo}`} />
              <p className="flex justify-between text-[11px] tabular-nums">
                <span>{l.accessionNo}</span>
                <span>{l.shelf ?? ""}</span>
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
