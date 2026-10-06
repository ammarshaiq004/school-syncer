import { readSheet } from "read-excel-file/browser";
import { cellText, parseCsv } from "./student-sheet";

/**
 * Reads a gateway statement (CSV or .xlsx from the merchant portal) into rows
 * of text. Columns are matched on the server, so every column is sent; empty
 * trailing rows and columns past the 80th are dropped.
 */
export async function readStatementFile(file: File): Promise<string[][]> {
  let grid: unknown[][];
  if (/\.csv$/i.test(file.name)) grid = parseCsv((await file.text()).replace(/^﻿/, ""));
  else if (/\.xlsx$/i.test(file.name)) grid = await readSheet(file);
  else throw new Error("Choose the statement as a CSV or Excel (.xlsx) file. Old .xls files need saving as .xlsx first.");
  const rows = grid.map((r) => r.slice(0, 80).map((c) => cellText(c).slice(0, 500)));
  while (rows.length && rows[rows.length - 1].every((c) => c === "")) rows.pop();
  if (rows.length < 2) throw new Error("The file has no transactions.");
  if (rows.length > 20_000) throw new Error("The file has more than 20,000 rows. Download one month at a time.");
  return rows;
}
