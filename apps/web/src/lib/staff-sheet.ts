import { readSheet } from "read-excel-file/browser";
import writeXlsxFile from "write-excel-file/browser";
import { cellText, parseCsv } from "./student-sheet.ts";

/** The columns of the staff import sheet, with the other names schools use for them. */
export const STAFF_COLUMNS = [
  { key: "employeeNo", title: "Employee No", aliases: ["emp no", "employee number", "staff id"], width: 13 },
  { key: "name", title: "Name", aliases: ["staff name", "full name", "employee name"], width: 22 },
  { key: "email", title: "Email", aliases: ["email address", "e-mail"], width: 26 },
  { key: "phone", title: "Phone", aliases: ["mobile", "contact", "whatsapp", "phone number"], width: 15 },
  { key: "role", title: "Role", aliases: ["login role", "access"], width: 14 },
  { key: "designation", title: "Designation", aliases: ["post", "position", "job title"], width: 20 },
  { key: "department", title: "Department", aliases: ["dept", "section"], width: 16 },
  { key: "joinedOn", title: "Joined On", aliases: ["joining date", "date of joining", "doj", "join date"], width: 13 },
  { key: "cnic", title: "CNIC", aliases: ["cnic no", "id card"], width: 17 },
  { key: "basicSalary", title: "Basic Salary", aliases: ["salary", "basic", "monthly salary"], width: 13 },
  { key: "bankName", title: "Bank Name", aliases: ["bank"], width: 16 },
  { key: "bankAccount", title: "Bank Account", aliases: ["account no", "account number", "iban"], width: 22 },
] as const;

type Key = (typeof STAFF_COLUMNS)[number]["key"];
export type StaffSheetRow = Partial<Record<Key, string>>;

export interface StaffReadResult {
  rows: StaffSheetRow[];
  /** Headers in the file that match no column, so the user knows they were skipped. */
  ignored: string[];
  missing: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[_.]/g, " ").replace(/\s+/g, " ").trim();

/** Turns a grid (first row = headers) into import rows, matching headers by name. */
export function staffGridToRows(grid: unknown[][]): StaffReadResult {
  const [header = [], ...body] = grid;
  const columnFor = new Map<number, Key>();
  const ignored: string[] = [];
  header.forEach((h, i) => {
    const name = norm(cellText(h));
    if (!name) return;
    const col = STAFF_COLUMNS.find((c) => norm(c.title) === name || c.key.toLowerCase() === name.replace(/ /g, "") || (c.aliases as readonly string[]).includes(name));
    if (col && ![...columnFor.values()].includes(col.key)) columnFor.set(i, col.key);
    else ignored.push(cellText(h));
  });
  const found = new Set(columnFor.values());
  const missing: string[] = (["name", "designation"] as Key[]).filter((k) => !found.has(k)).map((k) => STAFF_COLUMNS.find((c) => c.key === k)!.title);
  if (!found.has("email") && !found.has("phone")) missing.push("Email or Phone");
  const rows = body
    .map((cells) => {
      const row: StaffSheetRow = {};
      columnFor.forEach((key, i) => {
        const text = cellText(cells[i]);
        if (text) row[key] = text;
      });
      return row;
    })
    .filter((r) => Object.keys(r).length > 0);
  return { rows, ignored, missing };
}

export async function readStaffFile(file: File): Promise<StaffReadResult> {
  if (/\.csv$/i.test(file.name)) return staffGridToRows(parseCsv((await file.text()).replace(/^﻿/, "")));
  if (!/\.xlsx$/i.test(file.name)) throw new Error("Choose an Excel (.xlsx) or CSV file. Old .xls files need saving as .xlsx first.");
  return staffGridToRows(await readSheet(file));
}

/** A ready-to-fill sheet with the right headers and two example rows. */
export async function downloadStaffTemplate() {
  const examples: Record<Key, string>[] = [
    { employeeNo: "", name: "Ayesha Khan", email: "ayesha@example.pk", phone: "0300 1234567", role: "Teacher", designation: "Maths teacher", department: "Secondary", joinedOn: "01/08/2023", cnic: "35202-1234567-1", basicSalary: "45000", bankName: "HBL", bankAccount: "PK36HABB0000001123456702" },
    { employeeNo: "", name: "Bilal Ahmed", email: "", phone: "0333 1112223", role: "Staff", designation: "Accounts clerk", department: "Office", joinedOn: "15/03/2022", cnic: "", basicSalary: "30000", bankName: "", bankAccount: "" },
  ];
  await writeXlsxFile(
    [
      STAFF_COLUMNS.map((c) => ({ value: c.title, fontWeight: "bold" as const })),
      ...examples.map((e) => STAFF_COLUMNS.map((c) => ({ value: e[c.key], type: String }))),
    ],
    { columns: STAFF_COLUMNS.map((c) => ({ width: c.width })), sheet: "Staff" },
  ).toFile("staff-import-template.xlsx");
}
