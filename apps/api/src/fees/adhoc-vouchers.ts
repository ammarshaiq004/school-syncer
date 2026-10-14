import { FeeFrequency, InvoiceKind, InvoiceStatus, type Prisma } from '@prisma/client';
import { dayStart, localToday } from '../common/dates.js';
import { concessionApplies, type InvoiceLineDraft } from './fee-calculator.js';
import { voucherNo } from './invoice-codes.js';

/** Days a parent has to pay a one-off voucher (admission fee and the like). */
export const ADHOC_DUE_DAYS = 7;

/** The YYYY-MM-DD day `days` after today in the school's timezone. */
export function dueInDays(days: number, today = localToday()): string {
  const d = dayStart(today);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * A one-off voucher for one student, outside the monthly run: admission or
 * registration fee, a one-time charge. It is listed under the month it was
 * issued but never takes that month's place, so the monthly run still bills
 * the student.
 */
export async function createAdhocVoucher(
  tx: Prisma.TransactionClient,
  input: { schoolId: string; studentId: string; lines: InvoiceLineDraft[]; dueDate: string },
) {
  const period = localToday().slice(0, 7);
  const total = input.lines.reduce((s, l) => s + l.amount, 0);
  return tx.invoice.create({
    data: {
      schoolId: input.schoolId,
      studentId: input.studentId,
      voucherNo: voucherNo(period),
      period,
      kind: InvoiceKind.ADHOC,
      dueDate: dayStart(input.dueDate),
      total,
      status: total <= 0 ? InvoiceStatus.PAID : InvoiceStatus.UNPAID,
      lines: { create: input.lines },
    },
    include: { lines: true },
  });
}

/**
 * Bills a newly admitted student the school's admission fee, when one is set
 * up: the one-time fee head named in the fee rules, at the amount the fee
 * setup gives the student's class this year (less any concession on it).
 * Nothing happens when no head is chosen or the class has no amount for it.
 * Runs inside the admission's transaction, so both happen or neither does.
 */
export async function billAdmissionFee(tx: Prisma.TransactionClient, schoolId: string, studentId: string) {
  const school = await tx.school.findUniqueOrThrow({ where: { id: schoolId }, select: { admissionFeeHeadId: true } });
  if (!school.admissionFeeHeadId) return null;
  const head = await tx.feeHead.findFirst({
    where: { id: school.admissionFeeHeadId, schoolId, frequency: FeeFrequency.ONE_TIME },
  });
  if (!head) return null;
  const enrollment = await tx.enrollment.findFirst({
    where: { studentId, status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
    select: { academicYearId: true, section: { select: { classId: true } } },
  });
  if (!enrollment) return null;
  const structure = await tx.feeStructure.findUnique({
    where: {
      classId_feeHeadId_academicYearId: {
        classId: enrollment.section.classId,
        feeHeadId: head.id,
        academicYearId: enrollment.academicYearId,
      },
    },
  });
  if (!structure || structure.amount <= 0) return null;
  const lines: InvoiceLineDraft[] = [{ feeHeadId: head.id, description: head.name, amount: structure.amount }];
  const concession = await tx.concession.findUnique({ where: { studentId_feeHeadId: { studentId, feeHeadId: head.id } } });
  if (concession && concessionApplies(concession, localToday().slice(0, 7))) {
    const off =
      concession.type === 'PERCENT'
        ? Math.round((structure.amount * Math.min(concession.value, 100)) / 100)
        : Math.min(concession.value, structure.amount);
    if (off > 0) lines.push({ feeHeadId: head.id, description: `${head.name} concession`, amount: -off });
  }
  return createAdhocVoucher(tx, { schoolId, studentId, lines, dueDate: dueInDays(ADHOC_DUE_DAYS) });
}
