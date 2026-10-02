import { ConcessionType, FeeFrequency } from '@prisma/client';
import { invoiceLines, lateFine } from './fee-calculator.js';

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
