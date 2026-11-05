import { EntryKind } from '@prisma/client';
import { dayStart, localDate, startOfLocalDay } from '../common/dates.js';
import { nextDay } from '../common/date-range.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { cashbook, type CashMovement } from './cashbook.js';
import { moneyScope } from './money-scope.js';

/**
 * The cash book for a range of days: fee collections (one line per day and
 * method), other income and expenses, and salaries paid, with a running
 * balance from the opening balance. `scope` limits it to some campuses.
 */
export async function readBooks(prisma: PrismaService, schoolId: string, scope: string[] | null, from: string, to: string) {
  const start = startOfLocalDay(from);
  const end = startOfLocalDay(nextDay(to));
  const money = moneyScope(schoolId, scope);

  const [feesBefore, entriesBefore, salariesBefore, payments, entries, payslips] = await Promise.all([
    prisma.payment.aggregate({
      where: { schoolId, receivedAt: { lt: start }, reversedAt: null, ...money.payments },
      _sum: { amount: true },
    }),
    prisma.accountEntry.groupBy({
      by: ['kind'],
      where: { schoolId, date: { lt: dayStart(from) }, ...money.entries },
      _sum: { amount: true },
    }),
    prisma.payslip.aggregate({
      where: { run: { schoolId }, paidAt: { lt: start }, ...money.payslips },
      _sum: { net: true },
    }),
    prisma.payment.findMany({
      where: { schoolId, receivedAt: { gte: start, lt: end }, reversedAt: null, ...money.payments },
      select: { amount: true, method: true, receivedAt: true },
    }),
    prisma.accountEntry.findMany({
      where: { schoolId, date: { gte: dayStart(from), lte: dayStart(to) }, ...money.entries },
      include: { category: { select: { name: true } } },
    }),
    prisma.payslip.findMany({
      where: { run: { schoolId }, paidAt: { gte: start, lt: end }, ...money.payslips },
      include: { user: { select: { name: true } }, run: { select: { period: true } } },
    }),
  ]);

  const sumKind = (kind: EntryKind) => entriesBefore.find((e) => e.kind === kind)?._sum.amount ?? 0;
  const opening =
    (feesBefore._sum.amount ?? 0) + sumKind(EntryKind.INCOME) - sumKind(EntryKind.EXPENSE) - (salariesBefore._sum.net ?? 0);

  // Fee receipts are many and small, so the book shows one line per day and method.
  const feeDays = new Map<string, { date: string; method: string; amount: number; count: number }>();
  for (const p of payments) {
    const date = localDate(p.receivedAt);
    const key = `${date}|${p.method}`;
    const row = feeDays.get(key) ?? { date, method: p.method, amount: 0, count: 0 };
    row.amount += p.amount;
    row.count += 1;
    feeDays.set(key, row);
  }

  const movements: CashMovement[] = [
    ...[...feeDays.values()].map((f) => ({
      date: f.date,
      flow: 'IN' as const,
      amount: f.amount,
      source: 'FEES' as const,
      description: `Fee collections (${f.count} receipt${f.count === 1 ? '' : 's'})`,
      method: f.method,
    })),
    ...entries.map((e) => ({
      date: e.date.toISOString().slice(0, 10),
      flow: e.kind === EntryKind.INCOME ? ('IN' as const) : ('OUT' as const),
      amount: e.amount,
      source: 'ENTRY' as const,
      description: [e.category.name, e.party].filter(Boolean).join(': '),
      method: e.method,
      reference: e.reference,
    })),
    ...payslips.map((p) => ({
      date: localDate(p.paidAt!),
      flow: 'OUT' as const,
      amount: p.net,
      source: 'SALARY' as const,
      description: `Salary ${p.run.period}: ${p.user.name}`,
      method: p.paymentMethod ?? 'BANK',
    })),
  ];
  return cashbook(opening, movements);
}
