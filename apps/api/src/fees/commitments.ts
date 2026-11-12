import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { localDate } from '../common/dates.js';
import type { PrismaService } from '../prisma/prisma.service.js';

export type CommitmentStatus = 'PENDING' | 'KEPT' | 'BROKEN';

/**
 * Where a promise stands: kept once payments received since it was made (and no later than the
 * promised day) cover the amount, broken when the day has passed without that, otherwise pending.
 */
export function commitmentStatus(amount: number, promisedOn: string, paidByThen: number, today: string): CommitmentStatus {
  if (paidByThen >= amount) return 'KEPT';
  return today > promisedOn ? 'BROKEN' : 'PENDING';
}

/** A promise must be for a whole, positive amount, due today or later. */
export function checkCommitment(amount: number, promisedOn: string, today: string) {
  if (!Number.isInteger(amount) || amount <= 0) throw new BadRequestException('Enter the promised amount in whole rupees');
  if (promisedOn < today) throw new BadRequestException('The promised date cannot be in the past');
}

/** Live commitments matching `where`, each with its status worked out from the payments received. */
export async function commitmentsWithStatus(prisma: PrismaService, where: Prisma.FeeCommitmentWhereInput, today: string) {
  const rows = await prisma.feeCommitment.findMany({
    where: { cancelledAt: null, ...where },
    orderBy: [{ promisedOn: 'asc' }, { createdAt: 'asc' }],
    take: 500,
    include: { student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } } },
  });
  if (!rows.length) return [];
  const payments = await prisma.payment.findMany({
    where: {
      reversedAt: null,
      invoice: { studentId: { in: [...new Set(rows.map((r) => r.studentId))] } },
      receivedAt: { gte: new Date(Math.min(...rows.map((r) => r.createdAt.getTime()))) },
    },
    select: { amount: true, receivedAt: true, invoice: { select: { studentId: true } } },
  });
  return rows.map((r) => {
    const promisedOn = r.promisedOn.toISOString().slice(0, 10);
    const paid = payments
      .filter((p) => p.invoice.studentId === r.studentId && p.receivedAt >= r.createdAt && localDate(p.receivedAt) <= promisedOn)
      .reduce((n, p) => n + p.amount, 0);
    return {
      id: r.id,
      studentId: r.studentId,
      student: r.student,
      amount: r.amount,
      promisedOn,
      note: r.note,
      createdAt: r.createdAt,
      paid,
      status: commitmentStatus(r.amount, promisedOn, paid, today),
    };
  });
}
