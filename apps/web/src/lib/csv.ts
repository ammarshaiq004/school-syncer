type Cell = string | number | null | undefined;

/**
 * One CSV field. Text starting with = + - @ (or a tab or carriage return) is
 * prefixed with ' so spreadsheets show it instead of running it as a formula:
 * names and notes come from parents and staff. Plain numbers ("-500",
 * "+92 300 1234567" is not one) are left as they are.
 */
export function csvCell(v: Cell): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Downloads rows as a CSV file that Excel opens directly. */
export function downloadCsv(filename: string, header: string[], rows: Cell[][]) {
  const text = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
  // The byte-order mark makes Excel read the file as UTF-8 (Urdu names stay intact).
  const blob = new Blob(["﻿", text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
