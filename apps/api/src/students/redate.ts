import type { PrismaClient } from '@prisma/client';
import { localToday } from '../common/dates.js';
import { receivedInstant } from '../fees/paid-on.js';
import { studentDates } from './student-dates.js';

/** Hosts that mean "this computer" or the compose network of the local stack. Anything else is refused. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'host.docker.internal', 'postgres']);

/** Throws unless the database URL points at the local machine. The re-dating script calls this before anything else. */
export function assertLocalDatabase(url: string | undefined, env = process.env.NODE_ENV) {
  if (!url) throw new Error('DATABASE_URL is not set');
  if (env === 'production') throw new Error('Refusing to run with NODE_ENV=production');
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }
  if (!LOCAL_HOSTS.has(host)) throw new Error(`Refusing to run: database host "${host}" is not local. This script only fixes local data.`);
}

/** A small CSV reader: header row, quoted fields, "" for a quote. Header names are lower-cased. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  const [head, ...body] = rows;
  if (!head) return [];
  const names = head.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(names.map((n, i) => [n, (r[i] ?? '').trim()])));
}

export interface RedateReport {
  changed: number;
  problems: string[];
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (v: string) => ISO.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** students.csv: admissionNo, admissionDate, leftDate (YYYY-MM-DD; blank leaves a date as it is). */
export async function redateStudents(prisma: PrismaClient, schoolId: string, rows: Record<string, string>[], apply: boolean): Promise<RedateReport> {
  const report: RedateReport = { changed: 0, problems: [] };
  const today = localToday();
  for (const [i, r] of rows.entries()) {
    const at = `students line ${i + 2} (${r.admissionno || 'no admission no.'})`;
    const student = r.admissionno ? await prisma.student.findFirst({ where: { schoolId, admissionNo: r.admissionno } }) : null;
    if (!student) {
      report.problems.push(`${at}: no such student`);
      continue;
    }
    if ((r.admissiondate && !validDay(r.admissiondate)) || (r.leftdate && !validDay(r.leftdate))) {
      report.problems.push(`${at}: dates must be YYYY-MM-DD`);
      continue;
    }
    if (r.leftdate && student.status !== 'LEFT' && student.status !== 'GRADUATED') {
      report.problems.push(`${at}: has a leaving date but is not marked Left or Graduated`);
      continue;
    }
    try {
      const data = studentDates({
        before: student,
        status: student.status === 'GRADUATED' ? undefined : student.status,
        admittedOn: r.admissiondate ? new Date(`${r.admissiondate}T00:00:00Z`) : undefined,
        leftOn: r.leftdate ? new Date(`${r.leftdate}T00:00:00Z`) : undefined,
        today,
      });
      if (!Object.keys(data).length) continue;
      if (apply) await prisma.student.update({ where: { id: student.id }, data });
      report.changed++;
    } catch (e) {
      report.problems.push(`${at}: ${(e as Error).message}`);
    }
  }
  return report;
}

/** payments.csv: receiptNo, paidOn. Moves the receipt to that day (noon, school time) so reports count it there. */
export async function redatePayments(prisma: PrismaClient, schoolId: string, rows: Record<string, string>[], apply: boolean): Promise<RedateReport> {
  const report: RedateReport = { changed: 0, problems: [] };
  const today = localToday();
  for (const [i, r] of rows.entries()) {
    const at = `payments line ${i + 2} (${r.receiptno || 'no receipt no.'})`;
    if (!validDay(r.paidon ?? '')) {
      report.problems.push(`${at}: paidOn must be YYYY-MM-DD`);
      continue;
    }
    const payment = await prisma.payment.findFirst({ where: { schoolId, receiptNo: r.receiptno } });
    if (!payment) {
      report.problems.push(`${at}: no such receipt`);
      continue;
    }
    try {
      const receivedAt = receivedInstant(r.paidon, today);
      if (apply) await prisma.payment.update({ where: { id: payment.id }, data: { receivedAt } });
      report.changed++;
    } catch (e) {
      report.problems.push(`${at}: ${(e as Error).message}`);
    }
  }
  return report;
}

/** staff.csv: employeeNo, designation. Fills in designations so the dashboard can count teaching staff. */
export async function redateStaff(prisma: PrismaClient, schoolId: string, rows: Record<string, string>[], apply: boolean): Promise<RedateReport> {
  const report: RedateReport = { changed: 0, problems: [] };
  for (const [i, r] of rows.entries()) {
    const at = `staff line ${i + 2} (${r.employeeno || 'no employee no.'})`;
    if (!r.designation) {
      report.problems.push(`${at}: designation is blank`);
      continue;
    }
    const profile = r.employeeno ? await prisma.staffProfile.findFirst({ where: { schoolId, employeeNo: r.employeeno } }) : null;
    if (!profile) {
      report.problems.push(`${at}: no such employee`);
      continue;
    }
    if (apply) await prisma.staffProfile.update({ where: { id: profile.id }, data: { designation: r.designation.slice(0, 80) } });
    report.changed++;
  }
  return report;
}
