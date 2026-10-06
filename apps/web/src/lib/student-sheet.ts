import { readSheet } from "read-excel-file/browser";
import writeXlsxFile from "write-excel-file/browser";

/** The columns of the student import sheet, with the other names schools use for them. */
export const STUDENT_COLUMNS = [
  { key: "admissionNo", title: "Admission No", aliases: ["admission number", "adm no", "gr no", "reg no", "registration no"], width: 14 },
  { key: "campus", title: "Campus", aliases: ["branch", "campus name"], width: 14 },
  { key: "firstName", title: "First Name", aliases: ["student name", "name"], width: 16 },
  { key: "lastName", title: "Last Name", aliases: ["surname"], width: 14 },
  { key: "gender", title: "Gender", aliases: ["sex"], width: 9 },
  { key: "dateOfBirth", title: "Date of Birth", aliases: ["dob", "birth date"], width: 13 },
  { key: "class", title: "Class", aliases: ["grade"], width: 12 },
  { key: "section", title: "Section", aliases: [], width: 9 },
  { key: "rollNo", title: "Roll No", aliases: ["roll number", "roll"], width: 8 },
  { key: "bFormNo", title: "B-Form No", aliases: ["b form", "bform", "b-form"], width: 17 },
  { key: "address", title: "Address", aliases: [], width: 28 },
  { key: "guardianName", title: "Guardian Name", aliases: ["father name", "father's name", "parent name"], width: 18 },
  { key: "guardianRelation", title: "Guardian Relation", aliases: ["relation"], width: 10 },
  { key: "guardianPhone", title: "Guardian Phone", aliases: ["father phone", "phone", "mobile", "contact", "whatsapp"], width: 15 },
  { key: "guardianCnic", title: "Guardian CNIC", aliases: ["cnic", "father cnic"], width: 17 },
  { key: "guardian2Name", title: "Second Guardian Name", aliases: ["mother name", "mother's name"], width: 18 },
  { key: "guardian2Relation", title: "Second Guardian Relation", aliases: [], width: 10 },
  { key: "guardian2Phone", title: "Second Guardian Phone", aliases: ["mother phone"], width: 15 },
] as const;

export type StudentSheetRow = Partial<Record<(typeof STUDENT_COLUMNS)[number]["key"], string>>;

const norm = (s: string) => s.toLowerCase().replace(/[_.]/g, " ").replace(/\s+/g, " ").trim();

/** Excel dates arrive as Date objects; send them as the day-first text schools type. */
export function cellText(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(value.getUTCDate())}/${pad(value.getUTCMonth() + 1)}/${value.getUTCFullYear()}`;
  }
  return String(value).trim();
}

/** A small CSV reader: quoted cells, doubled quotes and new lines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

export interface ReadResult {
  rows: StudentSheetRow[];
  /** Headers in the file that match no column, so the user knows they were skipped. */
  ignored: string[];
  missing: string[];
}

/** Turns a grid (first row = headers) into import rows, matching headers by name. */
export function gridToRows(grid: unknown[][]): ReadResult {
  const [header = [], ...body] = grid;
  const columnFor = new Map<number, (typeof STUDENT_COLUMNS)[number]["key"]>();
  const ignored: string[] = [];
  header.forEach((h, i) => {
    const name = norm(cellText(h));
    if (!name) return;
    const col = STUDENT_COLUMNS.find((c) => norm(c.title) === name || c.key.toLowerCase() === name.replace(/ /g, "") || (c.aliases as readonly string[]).includes(name));
    if (col && ![...columnFor.values()].includes(col.key)) columnFor.set(i, col.key);
    else ignored.push(cellText(h));
  });
  const found = new Set(columnFor.values());
  const missing = ["firstName", "gender", "class", "guardianName", "guardianPhone"]
    .filter((k) => !found.has(k as never))
    .map((k) => STUDENT_COLUMNS.find((c) => c.key === k)!.title);
  const rows = body
    .map((cells) => {
      const row: StudentSheetRow = {};
      columnFor.forEach((key, i) => {
        const text = cellText(cells[i]);
        if (text) row[key] = text;
      });
      return row;
    })
    // Trailing blank lines in Excel are not students.
    .filter((r) => Object.keys(r).length > 0);
  return { rows, ignored, missing };
}

export async function readStudentFile(file: File): Promise<ReadResult> {
  if (/\.csv$/i.test(file.name)) return gridToRows(parseCsv((await file.text()).replace(/^﻿/, "")));
  if (!/\.xlsx$/i.test(file.name)) throw new Error("Choose an Excel (.xlsx) or CSV file. Old .xls files need saving as .xlsx first.");
  return gridToRows(await readSheet(file));
}

/**
 * A ready-to-fill sheet with the right headers and two example rows from this
 * school's classes, as [campus, class, section]. The Campus column is only
 * needed when campuses share class names.
 */
export async function downloadStudentTemplate(sections: string[][]) {
  const [first = ["", "Grade 1", "A"], second = first] = sections;
  const examples: Record<string, string>[] = [
    { admissionNo: "", firstName: "Ahmed", lastName: "Khan", gender: "Male", dateOfBirth: "14/08/2018", campus: first[0], class: first[1], section: first[2], rollNo: "", guardianName: "Imran Khan", guardianRelation: "Father", guardianPhone: "0300 1234567", guardianCnic: "35202-1234567-1", guardian2Name: "Sana Imran", guardian2Relation: "Mother", guardian2Phone: "0321 7654321" },
    { admissionNo: "", firstName: "Fatima", lastName: "Ali", gender: "Female", dateOfBirth: "02/01/2017", campus: second[0], class: second[1], section: second[2], rollNo: "", guardianName: "Asif Ali", guardianRelation: "Father", guardianPhone: "0333 1112223" },
  ];
  await writeXlsxFile(
    [
      STUDENT_COLUMNS.map((c) => ({ value: c.title, fontWeight: "bold" as const })),
      ...examples.map((e) => STUDENT_COLUMNS.map((c) => ({ value: e[c.key] ?? "", type: String }))),
    ],
    { columns: STUDENT_COLUMNS.map((c) => ({ width: c.width })), sheet: "Students" },
  ).toFile("students-import-template.xlsx");
}
