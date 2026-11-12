import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { dayStart, localToday } from '../common/dates.js';
import { createAdhocVoucher } from './adhoc-vouchers.js';

/**
 * A student's balance brought forward from another system. Owing (positive) becomes a one-off
 * voucher dated `asOf`, so it shows in defaulters and can be paid like any voucher; ahead
 * (negative) becomes advance credit that the next vouchers use up. Zero does nothing.
 */
export async function applyOpeningBalance(
  tx: Prisma.TransactionClient,
  input: { schoolId: string; studentId: string; amount: number; note?: string; asOf?: string; userId?: string },
) {
  const today = localToday();
  const asOf = input.asOf ?? today;
  if (asOf > today) throw new BadRequestException('The balance date cannot be in the future');
  if (!Number.isInteger(input.amount)) throw new BadRequestException('The opening balance must be a whole number');
  if (input.amount > 0) {
    const voucher = await createAdhocVoucher(tx, {
      schoolId: input.schoolId,
      studentId: input.studentId,
      lines: [{ feeHeadId: null, description: input.note || 'Opening balance', amount: input.amount }],
      dueDate: asOf,
      issuedOn: asOf,
    });
    return { kind: 'voucher' as const, id: voucher.id };
  }
  if (input.amount < 0) {
    const entry = await tx.studentCredit.create({
      data: {
        schoolId: input.schoolId,
        studentId: input.studentId,
        amount: -input.amount,
        note: input.note || 'Opening balance (advance)',
        effectiveOn: dayStart(asOf),
        createdById: input.userId,
      },
    });
    return { kind: 'credit' as const, id: entry.id };
  }
  return null;
}
