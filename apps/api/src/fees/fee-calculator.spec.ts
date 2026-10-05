import { ConcessionType, FeeFrequency } from '@prisma/client';
import { invoiceLines, lateFine, paymentRejection } from './fee-calculator.js';

const tuition = { feeHeadId: 't', feeHeadName: 'Tuition', frequency: FeeFrequency.MONTHLY, amount: 5000 };
const annual = { feeHeadId: 'a', feeHeadName: 'Annual charges', frequency: FeeFrequency.ANNUAL, amount: 8000 };

describe('invoiceLines', () => {
  it('bills monthly heads every month and annual heads only in the first month', () => {
    expect(invoiceLines([tuition, annual], [], false)).toEqual([
      { feeHeadId: 't', description: 'Tuition', amount: 5000 },
    ]);
    expect(invoiceLines([tuition, annual], [], true)).toHaveLength(2);
  });

  it('applies a percentage concession as a negative line', () => {
    const lines = invoiceLines([tuition], [{ feeHeadId: 't', type: ConcessionType.PERCENT, value: 25 }], false);
    expect(lines.reduce((sum, l) => sum + l.amount, 0)).toBe(3750);
  });

  it('never discounts more than the fee', () => {
    const lines = invoiceLines([tuition], [{ feeHeadId: 't', type: ConcessionType.FIXED, value: 9000 }], false);
    expect(lines.reduce((sum, l) => sum + l.amount, 0)).toBe(0);
  });
});

describe('lateFine', () => {
  it('charges per full day past the due date', () => {
    expect(lateFine(new Date('2026-10-10'), new Date('2026-10-13'), 50)).toBe(150);
    expect(lateFine(new Date('2026-10-10'), new Date('2026-10-09'), 50)).toBe(0);
  });
});

describe('paymentRejection', () => {
  const invoice = { total: 5000, paid: 2000 };

  it('takes anything up to the balance', () => {
    expect(paymentRejection(3000, invoice)).toBeNull();
    expect(paymentRejection(1, invoice)).toBeNull();
  });

  it('names the balance when the amount is above it', () => {
    expect(paymentRejection(3001, invoice)).toBe(
      "Rs 3,001 is more than this voucher's balance of Rs 3,000. Collect at most Rs 3,000.",
    );
  });

  it('allows the late fine on top, but no more', () => {
    expect(paymentRejection(3500, invoice, 500)).toBeNull();
    expect(paymentRejection(3501, invoice, 500)).toMatch(/plus the Rs 500 late fine/);
  });

  it('refuses any payment on a fully paid voucher', () => {
    expect(paymentRejection(100, { total: 5000, paid: 5000 }, 200)).toBe(
      'This voucher is already paid in full, so no further payment can be recorded.',
    );
  });
});
