import { InvoiceStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { familyTotals, spreadPayment } from './families.js';

describe('familyTotals', () => {
  it('counts carried-forward balances once and skips cancelled vouchers', () => {
    const t = familyTotals([
      { studentId: 'a', status: InvoiceStatus.CARRIED_FORWARD, total: 1000, paid: 400, arrears: 0 },
      { studentId: 'a', status: InvoiceStatus.PARTIAL, total: 1600, paid: 100, arrears: 600 },
      { studentId: 'b', status: InvoiceStatus.PAID, total: 800, paid: 800, arrears: 0 },
      { studentId: 'b', status: InvoiceStatus.CANCELLED, total: 800, paid: 0, arrears: 0 },
    ]);
    expect(t).toEqual({ billed: 2800, paid: 1300, balance: 1500 });
  });
});

describe('spreadPayment', () => {
  const owing = [
    { id: 'late', voucherNo: 'V2', dueDate: '2026-11-10', balance: 700 },
    { id: 'early', voucherNo: 'V1', dueDate: '2026-10-10', balance: 500 },
  ];
  it('pays the earliest due voucher first', () => {
    expect(spreadPayment(owing, 800)).toEqual([
      { invoiceId: 'early', amount: 500 },
      { invoiceId: 'late', amount: 300 },
    ]);
  });
  it('refuses more than the family owes', () => {
    expect(spreadPayment(owing, 1300)).toBeNull();
    expect(spreadPayment(owing, 1200)).toHaveLength(2);
  });
});
