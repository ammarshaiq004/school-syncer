import { cashbook, totalsBy, type CashMovement } from './cashbook.js';

const m = (date: string, flow: 'IN' | 'OUT', amount: number): CashMovement => ({
  date,
  flow,
  amount,
  source: 'ENTRY',
  description: '',
  method: 'CASH',
});

describe('cashbook', () => {
  it('runs a balance from the opening amount in date order, money in first each day', () => {
    const book = cashbook(1000, [m('2026-10-02', 'OUT', 300), m('2026-10-01', 'IN', 500), m('2026-10-02', 'IN', 200)]);
    expect(book.rows.map((r) => r.balance)).toEqual([1500, 1700, 1400]);
    expect(book).toMatchObject({ totalIn: 700, totalOut: 300, closing: 1400 });
  });

  it('handles an empty period', () => {
    expect(cashbook(250, [])).toMatchObject({ closing: 250, rows: [] });
  });
});

describe('totalsBy', () => {
  it('groups and sorts by total', () => {
    const items = [
      { c: 'Utilities', a: 100 },
      { c: 'Repairs', a: 500 },
      { c: 'Utilities', a: 50 },
    ];
    expect(totalsBy(items, (i) => i.c, (i) => i.a)).toEqual([
      { name: 'Repairs', total: 500 },
      { name: 'Utilities', total: 150 },
    ]);
  });
});
