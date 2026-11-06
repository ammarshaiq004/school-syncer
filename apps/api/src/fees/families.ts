import { InvoiceStatus, type Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import { billedOf } from './outstanding.js';
import { siblingRanks } from './siblings.js';

export const fullName = (s: { firstName: string; lastName: string | null }) =>
  [s.firstName, s.lastName].filter(Boolean).join(' ');

export interface Family {
  /** Id of the family's first-admitted child; stable while the family is the same. */
  id: string;
  children: { id: string; name: string; admissionNo: string }[];
  guardians: { name: string; phone: string }[];
}

/**
 * Families among the school's students (children sharing a guardian are one
 * family), optionally only students on some campuses. Left students are kept
 * because their families may still owe.
 */
export async function loadFamilies(
  prisma: PrismaService | Prisma.TransactionClient,
  schoolId: string,
  campusIds: string[] | null,
): Promise<Map<string, Family>> {
  const students = await prisma.student.findMany({
    where: { schoolId, ...(campusIds ? { campusId: { in: campusIds } } : {}) },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      admissionNo: true,
      admittedOn: true,
      guardians: { select: { guardianId: true, guardian: { select: { name: true, phone: true } } } },
    },
  });
  const byId = new Map(students.map((s) => [s.id, s]));
  const places = siblingRanks(
    students.map((s) => ({
      id: s.id,
      admittedOn: s.admittedOn,
      admissionNo: s.admissionNo,
      guardianIds: s.guardians.map((g) => g.guardianId),
    })),
  );
  const families = new Map<string, Family>();
  for (const place of places.values()) {
    const id = place.family[0];
    if (families.has(id)) continue;
    const kids = place.family.map((k) => byId.get(k)!);
    const seen = new Map<string, { name: string; phone: string }>();
    for (const k of kids) for (const g of k.guardians) seen.set(g.guardian.phone, g.guardian);
    families.set(id, {
      id,
      children: kids.map((k) => ({ id: k.id, name: fullName(k), admissionNo: k.admissionNo })),
      guardians: [...seen.values()],
    });
  }
  return families;
}

/** The family a student belongs to. */
export function familyOf(families: Map<string, Family>, studentId: string): Family | undefined {
  for (const f of families.values()) if (f.children.some((c) => c.id === studentId)) return f;
  return undefined;
}

export interface FamilyInvoice {
  studentId: string;
  status: InvoiceStatus;
  total: number;
  paid: number;
  arrears: number;
}

/**
 * What a family was billed and paid, and still owes. Balances carried forward
 * count as billed once: on the voucher they came from, not again as arrears.
 */
export function familyTotals(invoices: FamilyInvoice[]) {
  let billed = 0;
  let paid = 0;
  let balance = 0;
  for (const i of invoices) {
    if (i.status === InvoiceStatus.CANCELLED) continue;
    billed += billedOf(i);
    paid += i.paid;
    if (i.status === InvoiceStatus.UNPAID || i.status === InvoiceStatus.PARTIAL) balance += Math.max(0, i.total - i.paid);
  }
  return { billed, paid, balance };
}

export interface Owing {
  id: string;
  voucherNo: string;
  dueDate: string;
  balance: number;
}

/** One payment spread over a family's open vouchers, earliest due first; null if it is more than they owe. */
export function spreadPayment(owing: Owing[], amount: number): { invoiceId: string; amount: number }[] | null {
  const sorted = [...owing].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.voucherNo.localeCompare(b.voucherNo));
  let left = amount;
  const out: { invoiceId: string; amount: number }[] = [];
  for (const o of sorted) {
    if (left <= 0) break;
    const part = Math.min(left, o.balance);
    if (part > 0) out.push({ invoiceId: o.id, amount: part });
    left -= part;
  }
  return left > 0 ? null : out;
}
