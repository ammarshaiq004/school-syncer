import { Gender } from '@prisma/client';
import { z } from 'zod';
import type { GuardianInput } from './student-records.js';

/**
 * One spreadsheet row as the web app reads it: every cell is text (or empty),
 * so schools can paste whatever their old system exported and get a list of
 * what to fix instead of a failed upload.
 */
const cell = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => (v == null ? '' : String(v).trim()));

export const importRowSchema = z.object({
  admissionNo: cell,
  campus: cell,
  firstName: cell,
  lastName: cell,
  gender: cell,
  dateOfBirth: cell,
  class: cell,
  section: cell,
  rollNo: cell,
  bFormNo: cell,
  address: cell,
  guardianName: cell,
  guardianRelation: cell,
  guardianPhone: cell,
  guardianCnic: cell,
  guardian2Name: cell,
  guardian2Relation: cell,
  guardian2Phone: cell,
});
export type ImportRow = z.infer<typeof importRowSchema>;

export interface SectionRef {
  id: string;
  campusName: string;
  className: string;
  sectionName: string;
}

export interface ParsedStudent {
  sectionId: string;
  admissionNo?: string;
  rollNo?: number;
  firstName: string;
  lastName?: string;
  gender: Gender;
  dateOfBirth?: Date;
  bFormNo?: string;
  address?: string;
  guardians: GuardianInput[];
}

export interface CheckedRow {
  /** Spreadsheet row number, counting the header as row 1. */
  row: number;
  name: string;
  classSection: string;
  errors: string[];
  student?: ParsedStudent;
}

export function parseGender(value: string): Gender | undefined {
  const v = value.toLowerCase();
  if (['m', 'male', 'boy', 'b'].includes(v)) return Gender.MALE;
  if (['f', 'female', 'girl', 'g'].includes(v)) return Gender.FEMALE;
  if (['o', 'other'].includes(v)) return Gender.OTHER;
  return undefined;
}

/** Pakistani mobile numbers in any common spelling, as 03XXXXXXXXX. */
export function normalizePhone(value: string): string | undefined {
  let digits = value.replace(/[\s\-().]/g, '');
  if (digits.startsWith('+92')) digits = `0${digits.slice(3)}`;
  else if (digits.startsWith('0092')) digits = `0${digits.slice(4)}`;
  else if (digits.startsWith('92') && digits.length === 12)
    digits = `0${digits.slice(2)}`;
  else if (digits.startsWith('3') && digits.length === 10)
    digits = `0${digits}`;
  return /^03\d{9}$/.test(digits) ? digits : undefined;
}

/**
 * Dates as schools type them: 2015-03-21, 21/03/2015, 21-03-2015 or 21.03.2015
 * (day first, as in Pakistan). Returns the UTC-midnight Date @db.Date stores.
 */
export function parseDate(value: string): Date | undefined {
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (dmy) [d, m, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
  else return undefined;
  const date = new Date(Date.UTC(y, m - 1, d));
  const real =
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d;
  return real ? date : undefined;
}

const key = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Checks every row and turns the valid ones into students. Nothing is written
 * here; the controller imports only when no row has errors.
 */
export function checkImportRows(
  rows: ImportRow[],
  sections: SectionRef[],
  takenAdmissionNos: Set<string>,
  /** "sectionId|rollNo" for students already in this year's sections. */
  takenRolls: Set<string> = new Set(),
  /** Campuses of the school this login can't add students to. */
  otherCampuses: string[] = [],
  today = new Date(),
): CheckedRow[] {
  // Campuses often reuse class names, so one "Grade 1 A" can mean several sections.
  const sectionsByName = new Map<string, SectionRef[]>();
  for (const s of sections) {
    const k = `${key(s.className)}|${key(s.sectionName)}`;
    sectionsByName.set(k, [...(sectionsByName.get(k) ?? []), s]);
  }
  const seenAdmission = new Map<string, number>();
  const seenRoll = new Map<string, number>();

  return rows.map((r, i) => {
    const row = i + 2;
    const errors: string[] = [];
    const name = [r.firstName, r.lastName].filter(Boolean).join(' ');

    if (!r.firstName) errors.push('First name is missing');
    else if (r.firstName.length > 80) errors.push('First name is too long');
    if (r.lastName.length > 80) errors.push('Last name is too long');

    const gender = parseGender(r.gender);
    if (!gender)
      errors.push(
        r.gender
          ? `Gender "${r.gender}" should be Male or Female`
          : 'Gender is missing',
      );

    let dateOfBirth: Date | undefined;
    if (r.dateOfBirth) {
      dateOfBirth = parseDate(r.dateOfBirth);
      if (!dateOfBirth)
        errors.push(
          `Date of birth "${r.dateOfBirth}" should look like 21/03/2015`,
        );
      else if (dateOfBirth > today)
        errors.push('Date of birth is in the future');
    }

    // A single "Class" cell like "Grade 1 A" works when the section column is empty.
    let className = r.class;
    let sectionName = r.section;
    if (!sectionName) {
      const split = /^(.*\S)\s*[-\s]\s*(\S+)$/.exec(className);
      if (split && sectionsByName.has(`${key(split[1])}|${key(split[2])}`))
        [, className, sectionName] = split;
    }
    const classSection = [className, sectionName].filter(Boolean).join(' ');
    const named =
      sectionsByName.get(`${key(className)}|${key(sectionName)}`) ?? [];
    const matches = r.campus
      ? named.filter((s) => key(s.campusName) === key(r.campus))
      : named;
    const sectionId = matches.length === 1 ? matches[0].id : undefined;
    if (!className) errors.push('Class is missing');
    else if (!sectionName) errors.push('Section is missing');
    else if (!named.length)
      errors.push(`No section "${classSection}" this year`);
    else if (!matches.length)
      errors.push(
        otherCampuses.some((c) => key(c) === key(r.campus))
          ? `Your login can't add students at ${r.campus}`
          : `No section "${classSection}" at ${r.campus}`,
      );
    else if (matches.length > 1)
      errors.push(
        `"${classSection}" is at more than one campus (${matches.map((s) => s.campusName).join(', ')}); fill in the Campus column`,
      );

    if (r.admissionNo) {
      const no = r.admissionNo;
      if (no.length > 30) errors.push('Admission number is too long');
      if (takenAdmissionNos.has(no))
        errors.push(`Admission number ${no} already belongs to a student`);
      const earlier = seenAdmission.get(no);
      if (earlier)
        errors.push(`Admission number ${no} is also on row ${earlier}`);
      else seenAdmission.set(no, row);
    }

    let rollNo: number | undefined;
    if (r.rollNo) {
      rollNo = Number(r.rollNo);
      if (!Number.isInteger(rollNo) || rollNo < 1 || rollNo > 9999) {
        errors.push(`Roll number "${r.rollNo}" should be a whole number`);
        rollNo = undefined;
      } else if (sectionId && takenRolls.has(`${sectionId}|${rollNo}`)) {
        errors.push(
          `Roll number ${rollNo} is already taken in ${classSection}`,
        );
      } else if (sectionId) {
        const earlier = seenRoll.get(`${sectionId}|${rollNo}`);
        if (earlier)
          errors.push(`Roll number ${rollNo} is also on row ${earlier}`);
        else seenRoll.set(`${sectionId}|${rollNo}`, row);
      }
    }

    if (r.bFormNo.length > 20) errors.push('B-Form number is too long');
    if (r.address.length > 250) errors.push('Address is too long');

    const guardians: GuardianInput[] = [];
    const guardian = (
      label: string,
      nameCell: string,
      relation: string,
      phoneCell: string,
      cnic = '',
    ) => {
      if (!nameCell && !phoneCell) return false;
      const phone = normalizePhone(phoneCell);
      if (nameCell.length < 2) errors.push(`${label} name is missing`);
      if (!phoneCell) errors.push(`${label} phone is missing`);
      else if (!phone)
        errors.push(
          `${label} phone "${phoneCell}" should be a mobile number like 0300 1234567`,
        );
      if (cnic.length > 20) errors.push(`${label} CNIC is too long`);
      if (phone && nameCell.length >= 2) {
        guardians.push({
          name: nameCell.slice(0, 120),
          phone,
          relation: (relation || 'Guardian').slice(0, 30),
          cnic: cnic || undefined,
          isPrimary: guardians.length === 0,
        });
      }
      return true;
    };
    if (
      !guardian(
        'Guardian',
        r.guardianName,
        r.guardianRelation,
        r.guardianPhone,
        r.guardianCnic,
      )
    ) {
      errors.push('Guardian name and phone are missing');
    }
    guardian(
      'Second guardian',
      r.guardian2Name,
      r.guardian2Relation,
      r.guardian2Phone,
    );
    if (guardians.length === 2 && guardians[0].phone === guardians[1].phone) {
      errors.push('Both guardians have the same phone');
    }

    const checked: CheckedRow = { row, name, classSection, errors };
    if (!errors.length && sectionId && gender) {
      checked.student = {
        sectionId,
        admissionNo: r.admissionNo || undefined,
        rollNo,
        firstName: r.firstName,
        lastName: r.lastName || undefined,
        gender,
        dateOfBirth,
        bFormNo: r.bFormNo || undefined,
        address: r.address || undefined,
        guardians,
      };
    }
    return checked;
  });
}
