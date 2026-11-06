import { describe, expect, it } from 'vitest';
import { addMonths, allocate, evenSplit, planProblem } from './installments.js';

describe('addMonths', () => {
  it('keeps the day and clamps to short months', () => {
    expect(addMonths('2026-10-10', 2)).toBe('2026-12-10');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
  });
});

describe('evenSplit', () => {
  it('puts the odd rupees on the first instalments and adds up exactly', () => {
    const plan = evenSplit(10_001, 3, '2026-11-05');
    expect(plan.map((p) => p.amount)).toEqual([3334, 3334, 3333]);
    expect(plan.map((p) => p.dueDate)).toEqual(['2026-11-05', '2026-12-05', '2027-01-05']);
    expect(planProblem(plan, 10_001)).toBeNull();
  });
});

describe('planProblem', () => {
  const ok = [
    { dueDate: '2026-11-05', amount: 500 },
    { dueDate: '2026-12-05', amount: 500 },
  ];
  it('accepts a plan that adds up', () => expect(planProblem(ok, 1000)).toBeNull());
  it('refuses a total that does not match', () => expect(planProblem(ok, 1200)).toMatch(/add up to Rs 1000/));
  it('refuses one instalment, zero amounts and unordered dates', () => {
    expect(planProblem([ok[0]], 500)).toMatch(/at least two/);
    expect(planProblem([ok[0], { dueDate: '2026-12-05', amount: 0 }], 500)).toMatch(/more than zero/);
    expect(planProblem([ok[1], ok[0]], 1000)).toMatch(/in order/);
  });
  it('refuses more than 12', () => {
    expect(planProblem(evenSplit(1200, 13, '2026-01-01'), 1200)).toMatch(/at most 12/);
  });
});

describe('allocate', () => {
  const items = [
    { dueDate: '2026-11-01', amount: 400 },
    { dueDate: '2026-12-01', amount: 400 },
    { dueDate: '2027-01-01', amount: 400 },
  ];
  it('fills instalments in order and flags the overdue one', () => {
    const rows = allocate(items, 1200, 500, '2026-12-15');
    expect(rows.map((r) => [r.paid, r.status])).toEqual([
      [400, 'PAID'],
      [100, 'OVERDUE'],
      [0, 'UNPAID'],
    ]);
  });
  it('marks a part-paid instalment that is not yet due as PARTIAL', () => {
    expect(allocate(items, 1200, 100, '2026-10-01')[0].status).toBe('PARTIAL');
  });
  it('owes a late fine added after the plan with the last instalment', () => {
    const rows = allocate(items, 1300, 1200, '2027-02-01');
    expect(rows[2]).toMatchObject({ amount: 500, paid: 400, balance: 100, status: 'OVERDUE' });
  });
});
