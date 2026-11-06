import { Role } from '@prisma/client';
import { z } from 'zod';
import { normalizeCnic, normalizePhone } from '../common/identity.js';
import { parseDate } from '../students/student-import.js';

/** One spreadsheet row as the web app reads it: every cell is text, so mistakes become a list to fix. */
const cell = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => (v == null ? '' : String(v).trim()));

export const staffRowSchema = z.object({
  employeeNo: cell,
  name: cell,
  email: cell,
  phone: cell,
  role: cell,
  designation: cell,
  department: cell,
  joinedOn: cell,
  cnic: cell,
  basicSalary: cell,
  bankName: cell,
  bankAccount: cell,
});
export type StaffRow = z.infer<typeof staffRowSchema>;

/** Roles an import may hand out. Admin-level and fee roles are given on the Users screen. */
export const IMPORT_ROLES: Record<string, Role> = {
  teacher: Role.TEACHER,
  'class teacher': Role.CLASS_TEACHER,
  staff: Role.STAFF,
};

export interface ParsedStaff {
  name: string;
  email?: string;
  phone?: string;
  role: Role;
  employeeNo?: string;
  designation: string;
  department?: string;
  joinedOn?: Date;
  cnic?: string;
  basicSalary: number;
  bankName?: string;
  bankAccount?: string;
}

export interface CheckedStaffRow {
  /** Spreadsheet row number, counting the header as row 1. */
  row: number;
  name: string;
  errors: string[];
  staff?: ParsedStaff;
}

const EMAIL = z.email();
const lower = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Rupee amounts as typed: "45,000", "Rs 45000", "45000.00". */
export function parseRupees(value: string): number | undefined {
  if (!value) return 0;
  const n = Number(value.replace(/rs\.?|pkr|,|\s/gi, ''));
  return Number.isFinite(n) && n >= 0 && n <= 100_000_000 ? Math.round(n) : undefined;
}

/**
 * Checks every row and turns the valid ones into staff. Nothing is written
 * here; the controller imports only when no row has errors.
 */
export function checkStaffRows(
  rows: StaffRow[],
  taken: { emails: Set<string>; phones: Set<string>; employeeNos: Set<string> },
): CheckedStaffRow[] {
  const seen = { email: new Map<string, number>(), phone: new Map<string, number>(), employeeNo: new Map<string, number>() };
  return rows.map((r, i) => {
    const row = i + 2;
    const errors: string[] = [];
    if (r.name.length < 2) errors.push('Name is required');
    if (r.designation.length < 2) errors.push('Designation is required');
    const email = r.email.toLowerCase();
    if (email && !EMAIL.safeParse(email).success) errors.push(`"${r.email}" is not a valid email`);
    const phone = r.phone ? normalizePhone(r.phone) : undefined;
    if (r.phone && !phone) errors.push(`"${r.phone}" is not a mobile number like 0300 1234567`);
    if (!email && !r.phone) errors.push('Give an email or a phone number');
    const cnic = r.cnic ? normalizeCnic(r.cnic) : undefined;
    if (r.cnic && !cnic) errors.push(`"${r.cnic}" is not a 13-digit CNIC`);
    const role = r.role ? IMPORT_ROLES[lower(r.role)] : Role.TEACHER;
    if (!role) errors.push(`Role "${r.role}" is not one of: Teacher, Class Teacher, Staff`);
    const basicSalary = parseRupees(r.basicSalary);
    if (basicSalary === undefined) errors.push(`"${r.basicSalary}" is not a salary amount`);
    const joinedOn = r.joinedOn ? parseDate(r.joinedOn) : undefined;
    if (r.joinedOn && !joinedOn) errors.push(`"${r.joinedOn}" is not a date like 21/03/2024`);

    const claim = (kind: keyof typeof seen, value: string | undefined, label: string, existing: Set<string>) => {
      if (!value) return;
      if (existing.has(value)) errors.push(`${label} ${value} is already used at this school`);
      const first = seen[kind].get(value);
      if (first) errors.push(`${label} ${value} is also on row ${first}`);
      else seen[kind].set(value, row);
    };
    claim('email', email || undefined, 'Email', taken.emails);
    claim('phone', phone, 'Phone', taken.phones);
    claim('employeeNo', r.employeeNo || undefined, 'Employee number', taken.employeeNos);

    return {
      row,
      name: r.name,
      errors,
      staff: errors.length
        ? undefined
        : {
            name: r.name,
            email: email || undefined,
            phone,
            role: role!,
            employeeNo: r.employeeNo || undefined,
            designation: r.designation,
            department: r.department || undefined,
            joinedOn,
            cnic,
            basicSalary: basicSalary!,
            bankName: r.bankName || undefined,
            bankAccount: r.bankAccount || undefined,
          },
    };
  });
}
