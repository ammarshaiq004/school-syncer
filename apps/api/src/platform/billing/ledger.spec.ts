import { describe, expect, it } from 'vitest';
import { allocate, withTax, type LedgerInvoice, type LedgerPayment } from './ledger.js';

const bill = (id: string, amount: number, due: string): LedgerInvoice => ({
  id,
  amount,
  dueDate: new Date(`${due}T00:00:00Z`),
  number: `SS-${due.slice(0, 7).replace('-', '')}-${id}`,
});
const pay = (id: string, amount: number, on: string, at = 0): LedgerPayment => ({
  id,
  amount,
  receivedOn: new Date(`${on}T00:00:00Z`),
  createdAt: new Date(at),
  method: 'Bank transfer',
  reference: `REF-${id}`,
});

describe('allocate', () => {
  it('pays the oldest bill first and carries the rest to the next', () => {
    const r = allocate([bill('b2', 10_000, '2026-10-10'), bill('b1', 10_000, '2026-09-10')], [pay('p1', 15_000, '2026-10-12')]);
    expect(r.allocations).toEqual([
      { paymentId: 'p1', invoiceId: 'b1', amount: 10_000 },
      { paymentId: 'p1', invoiceId: 'b2', amount: 5_000 },
    ]);
    expect(r.invoices.get('b1')).toMatchObject({ amountPaid: 10_000, settledBy: { id: 'p1' } });
    expect(r.invoices.get('b2')).toMatchObject({ amountPaid: 5_000, settledBy: null });
    expect(r.outstanding).toBe(5_000);
    expect(r.credit).toBe(0);
  });

  it('keeps an overpayment as credit, which pays a later bill', () => {
    const first = allocate([bill('b1', 10_000, '2026-09-10')], [pay('p1', 12_500, '2026-09-05')]);
    expect(first.credit).toBe(2_500);
    expect(first.outstanding).toBe(0);
    const next = allocate([bill('b1', 10_000, '2026-09-10'), bill('b2', 10_000, '2026-10-10')], [pay('p1', 12_500, '2026-09-05')]);
    expect(next.invoices.get('b2')!.amountPaid).toBe(2_500);
    expect(next.credit).toBe(0);
    expect(next.outstanding).toBe(7_500);
  });

  it('applies payments in the order they arrived and names the one that settled a bill', () => {
    const r = allocate([bill('b1', 10_000, '2026-09-10')], [pay('late', 6_000, '2026-09-08'), pay('early', 4_000, '2026-09-01')]);
    expect(r.allocations.map((a) => a.paymentId)).toEqual(['early', 'late']);
    expect(r.invoices.get('b1')!.settledBy!.id).toBe('late');
  });

  it('orders same-day payments by when they were recorded', () => {
    const r = allocate([bill('b1', 5_000, '2026-09-10')], [pay('second', 5_000, '2026-09-01', 2), pay('first', 5_000, '2026-09-01', 1)]);
    expect(r.invoices.get('b1')!.settledBy!.id).toBe('first');
    expect(r.credit).toBe(5_000);
  });

  it('leaves everything owed with no payments', () => {
    const r = allocate([bill('b1', 5_000, '2026-09-10'), bill('b2', 7_000, '2026-10-10')], []);
    expect(r.allocations).toEqual([]);
    expect(r.outstanding).toBe(12_000);
    expect(r.credit).toBe(0);
  });

  it('turns all payments into credit when there are no bills', () => {
    expect(allocate([], [pay('p1', 3_000, '2026-09-01')]).credit).toBe(3_000);
  });

  it('treats a zero bill as paid', () => {
    const r = allocate([bill('b0', 0, '2026-09-10'), bill('b1', 1_000, '2026-10-10')], [pay('p1', 1_000, '2026-10-01')]);
    expect(r.invoices.get('b1')!.amountPaid).toBe(1_000);
    expect(r.outstanding).toBe(0);
  });
});

describe('withTax', () => {
  it('adds no tax while tax is off', () => {
    expect(withTax(10_000, null)).toEqual({ amount: 10_000, taxPercent: 0, taxAmount: 0 });
    expect(withTax(10_000, 0)).toEqual({ amount: 10_000, taxPercent: 0, taxAmount: 0 });
  });
  it('adds tax rounded to the rupee', () => {
    expect(withTax(10_001, 16)).toEqual({ amount: 11_601, taxPercent: 16, taxAmount: 1_600 });
  });
});
