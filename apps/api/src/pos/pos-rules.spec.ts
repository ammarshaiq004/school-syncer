import { describe, expect, it } from 'vitest';
import { documentNumber, mergeLines, owed, rollup, saleTotals, stockAfter } from './pos-rules.js';

describe('pos rules', () => {
  it('merges repeated products into one line', () => {
    expect(mergeLines([{ itemId: 'a', qty: 1 }, { itemId: 'b', qty: 2 }, { itemId: 'a', qty: 3 }])).toEqual([
      { itemId: 'a', qty: 4 },
      { itemId: 'b', qty: 2 },
    ]);
  });

  it('totals a sale and refuses a discount larger than the goods', () => {
    const lines = [{ qty: 2, unitPrice: 50 }, { qty: 1, unitPrice: 120 }];
    expect(saleTotals(lines, 20)).toEqual({ subtotal: 220, total: 200 });
    expect(saleTotals(lines, 220)).toEqual({ subtotal: 220, total: 0 });
    expect(saleTotals(lines, 221)).toBeNull();
  });

  it('numbers documents after the ones already issued', () => {
    expect(documentNumber('S', 0)).toBe('S-000001');
    expect(documentNumber('PUR', 41, 4)).toBe('PUR-0042');
  });

  it('never lets stock go below zero', () => {
    expect(stockAfter(5, -5)).toBe(0);
    expect(stockAfter(5, -6)).toBeNull();
    expect(stockAfter(0, 12)).toBe(12);
  });

  it('works out what is still owed', () => {
    expect(owed(1000, 400)).toBe(600);
    expect(owed(1000, 1200)).toBe(0);
  });

  it('rolls rows up by key', () => {
    const rows = [
      { day: 'Mon', sales: 100, cost: 60 },
      { day: 'Tue', sales: 50, cost: 20 },
      { day: 'Mon', sales: 25, cost: 10 },
    ];
    expect(rollup(rows, (r) => r.day, { sales: (r) => r.sales, cost: (r) => r.cost })).toEqual([
      { key: 'Mon', sales: 125, cost: 70 },
      { key: 'Tue', sales: 50, cost: 20 },
    ]);
  });
});
