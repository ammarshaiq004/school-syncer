import { readSheet } from "read-excel-file/browser";
import writeXlsxFile from "write-excel-file/browser";
import { cellText, parseCsv } from "./student-sheet.ts";

/** The columns of the book import sheet, with the other names schools use for them. */
export const BOOK_COLUMNS = [
  { key: "title", title: "Title", aliases: ["book", "book name", "name"], width: 30 },
  { key: "author", title: "Author", aliases: ["writer"], width: 20 },
  { key: "isbn", title: "ISBN", aliases: ["isbn no", "isbn number"], width: 16 },
  { key: "publisher", title: "Publisher", aliases: [], width: 18 },
  { key: "category", title: "Category", aliases: ["subject", "type"], width: 14 },
  { key: "language", title: "Language", aliases: [], width: 10 },
  { key: "shelf", title: "Shelf", aliases: ["rack", "location"], width: 8 },
  { key: "copies", title: "Copies", aliases: ["quantity", "qty", "count", "no of copies"], width: 8 },
] as const;

export type BookSheetRow = Partial<Record<(typeof BOOK_COLUMNS)[number]["key"], string>>;

const norm = (s: string) => s.toLowerCase().replace(/[_.]/g, " ").replace(/\s+/g, " ").trim();

export interface BookReadResult {
  rows: BookSheetRow[];
  ignored: string[];
  missing: string[];
}

/** Turns a grid (first row = headers) into import rows, matching headers by name. */
export function gridToBookRows(grid: unknown[][]): BookReadResult {
  const [header = [], ...body] = grid;
  const columnFor = new Map<number, (typeof BOOK_COLUMNS)[number]["key"]>();
  const ignored: string[] = [];
  header.forEach((h, i) => {
    const name = norm(cellText(h));
    if (!name) return;
    const col = BOOK_COLUMNS.find((c) => norm(c.title) === name || (c.aliases as readonly string[]).includes(name));
    if (col && ![...columnFor.values()].includes(col.key)) columnFor.set(i, col.key);
    else ignored.push(cellText(h));
  });
  const missing = [...columnFor.values()].includes("title") ? [] : ["Title"];
  const rows = body
    .map((cells) => {
      const row: BookSheetRow = {};
      columnFor.forEach((key, i) => {
        const text = cellText(cells[i]);
        if (text) row[key] = text;
      });
      return row;
    })
    .filter((r) => Object.keys(r).length > 0);
  return { rows, ignored, missing };
}

export async function readBookFile(file: File): Promise<BookReadResult> {
  if (/\.csv$/i.test(file.name)) return gridToBookRows(parseCsv((await file.text()).replace(/^﻿/, "")));
  if (!/\.xlsx$/i.test(file.name)) throw new Error("Choose an Excel (.xlsx) or CSV file. Old .xls files need saving as .xlsx first.");
  return gridToBookRows(await readSheet(file));
}

export async function downloadBookTemplate() {
  const examples = [
    { title: "Gulistan-e-Saadi", author: "Sheikh Saadi", isbn: "978-969-8123-45-6", publisher: "Ferozsons", category: "Poetry", language: "Urdu", shelf: "B-3", copies: "3" },
    { title: "The Jungle Book", author: "Rudyard Kipling", isbn: "", publisher: "", category: "Fiction", language: "English", shelf: "A-1", copies: "2" },
  ] as Record<string, string>[];
  await writeXlsxFile(
    [BOOK_COLUMNS.map((c) => ({ value: c.title, fontWeight: "bold" as const })), ...examples.map((e) => BOOK_COLUMNS.map((c) => ({ value: e[c.key] ?? "", type: String })))],
    { columns: BOOK_COLUMNS.map((c) => ({ width: c.width })), sheet: "Books" },
  ).toFile("books-import-template.xlsx");
}
