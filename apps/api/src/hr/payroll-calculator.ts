import { PayItemType } from '@prisma/client';

/** Every YYYY-MM-DD in a month that is a working day (Sunday off by default). */
export function workingDays(period: string, weeklyOff: number[] = [0]): string[] {
  const [year, month] = period.split('-').map(Number);
  const days: string[] = [];
  for (let d = new Date(Date.UTC(year, month - 1, 1)); d.getUTCMonth() === month - 1; d.setUTCDate(d.getUTCDate() + 1)) {
    if (!weeklyOff.includes(d.getUTCDay())) days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

/** Working days from one date to another, inclusive. */
export function daysBetween(from: string, to: string, weeklyOff: number[] = [0]): string[] {
  const days: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    if (!weeklyOff.includes(d.getUTCDay())) days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

export interface PayItem {
  name: string;
  type: PayItemType;
  amount: number;
}

export interface PayslipLine {
  name: string;
  type: PayItemType;
  amount: number;
}

/**
 * One month's pay: basic plus allowances, less fixed deductions and a
 * day's basic for each unpaid day (absent, or on unpaid leave).
 */
export function calculatePayslip(input: {
  basic: number;
  items: PayItem[];
  unpaidDays: number;
  workingDays: number;
}) {
  const allowances = input.items.filter((i) => i.type === PayItemType.ALLOWANCE).reduce((s, i) => s + i.amount, 0);
  const deductions = input.items.filter((i) => i.type === PayItemType.DEDUCTION).reduce((s, i) => s + i.amount, 0);
  const days = Math.min(input.unpaidDays, input.workingDays);
  const unpaidDeduction = input.workingDays ? Math.round((input.basic / input.workingDays) * days) : 0;
  const lines: PayslipLine[] = [
    { name: 'Basic salary', type: PayItemType.ALLOWANCE, amount: input.basic },
    ...input.items.map(({ name, type, amount }) => ({ name, type, amount })),
  ];
  if (unpaidDeduction) {
    lines.push({
      name: `Unpaid days (${days})`,
      type: PayItemType.DEDUCTION,
      amount: unpaidDeduction,
    });
  }
  return {
    basic: input.basic,
    allowances,
    deductions,
    unpaidDays: days,
    unpaidDeduction,
    net: Math.max(0, input.basic + allowances - deductions - unpaidDeduction),
    lines,
  };
}
