import { describe, expect, it } from 'vitest';
import { cashbook } from './cashbook.js';
import { buildPnl, closingSummary, monthDays, twelveMonths, userwise } from './closing.js';

const book = cashbook(1000, [
  { date: '2026-11-02', flow: 'IN', amount: 500, source: 'FEES', description: '', method: 'CASH' },
  { date: '2026-11-02', flow: 'IN', amount: 300, source: 'FEES', description: '', method: 'BANK' },
  { date: '2026-11-02', flow: 'OUT', amount: 200, source: 'ENTRY', description: '', method: 'CASH' },
  { date: '2026-11-04', flow: 'OUT', amount: 100, source: 'SALARY', description: '', method: 'BANK' },
]);

describe('closingSummary', () => {
  it('splits a day by method and source and keeps the balances', () => {
    const s = closingSummary(book);
    expect(s).toMatchObject({ opening: 1000, totalIn: 800, totalOut: 300, closing: 1500 });
    expect(s.in.byMethod).toEqual([
      { name: 'CASH', total: 500 },
      { name: 'BANK', total: 300 },
    ]);
    expect(s.out.bySource).toEqual([
      { name: 'ENTRY', total: 200 },
      { name: 'SALARY', total: 100 },
    ]);
  });
});

describe('monthDays', () => {
  it('lists every day with its closing balance, including quiet days', () => {
    const days = monthDays(book, '2026-11-01', '2026-11-04');
    expect(days.map((d) => [d.date, d.in, d.out, d.closing])).toEqual([
      ['2026-11-01', 0, 0, 1000],
      ['2026-11-02', 800, 200, 1600],
      ['2026-11-03', 0, 0, 1600],
      ['2026-11-04', 0, 100, 1500],
    ]);
    expect(days.at(-1)!.closing).toBe(book.closing);
  });
});

describe('buildPnl', () => {
  it('builds twelve months from any start and ignores money outside them', () => {
    const months = twelveMonths('2026-07');
    expect(months[0]).toBe('2026-07');
    expect(months[11]).toBe('2027-06');
    const pnl = buildPnl(
      months,
      [
        { month: '2026-07', amount: 1000 },
        { month: '2026-08', amount: 2000 },
        { month: '2027-07', amount: 9999 },
      ],
      [
        { month: '2026-07', kind: 'INCOME', category: 'Canteen rent', amount: 100 },
        { month: '2026-08', kind: 'EXPENSE', category: 'Utilities', amount: 400 },
      ],
      [{ month: '2026-08', amount: 1500 }],
    );
    expect(pnl.income.map((r) => r.name)).toEqual(['Fees', 'Canteen rent']);
    expect(pnl.expenses.map((r) => [r.name, r.total])).toEqual([
      ['Salaries', 1500],
      ['Utilities', 400],
    ]);
    expect(pnl.netByMonth.slice(0, 2)).toEqual([1100, 100]);
    expect(pnl).toMatchObject({ totalIncome: 3100, totalExpenses: 1900, net: 1200 });
  });
});

describe('userwise', () => {
  it('nets each user and groups gateway money under no user', () => {
    const rows = userwise(
      [
        { userId: 'a', amount: 500 },
        { userId: 'a', amount: 250 },
        { userId: null, amount: 400 },
      ],
      [
        { userId: 'a', kind: 'EXPENSE', amount: 100 },
        { userId: 'b', kind: 'INCOME', amount: 50 },
      ],
      [{ userId: 'b', amount: 20 }],
    );
    expect(rows.find((r) => r.userId === 'a')).toMatchObject({ collected: 750, receipts: 2, expenses: 100, net: 650 });
    expect(rows.find((r) => r.userId === null)).toMatchObject({ collected: 400, net: 400 });
    expect(rows.find((r) => r.userId === 'b')).toMatchObject({ otherIncome: 50, salaries: 20, net: 30 });
    expect(rows[0].userId).toBe('a');
  });
});
