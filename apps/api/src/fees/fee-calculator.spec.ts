import { ConcessionType, FeeFrequency, InvoiceLineKind, InvoiceStatus } from '@prisma/client';
import {
  concessionApplies,
  fineDue,
  invoiceLines,
  invoiceStatus,
  lateFine,
  paymentRejection,
  siblingPercent,
} from './fee-calculator.js';

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

describe('concessions with a validity window', () => {
  const c = { feeHeadId: 't', type: ConcessionType.PERCENT, value: 50, validFrom: '2026-05', validTo: '2026-07' };

  it('applies only in the months it covers', () => {
    expect(concessionApplies(c, '2026-04')).toBe(false);
    expect(concessionApplies(c, '2026-05')).toBe(true);
    expect(concessionApplies(c, '2026-07')).toBe(true);
    expect(concessionApplies(c, '2026-08')).toBe(false);
    expect(concessionApplies({ ...c, validFrom: null, validTo: null }, '2030-01')).toBe(true);
    expect(invoiceLines([tuition], [c], false, '2026-08')).toHaveLength(1);
    expect(invoiceLines([tuition], [c], false, '2026-06')).toHaveLength(2);
  });
});

describe('sibling discount', () => {
  const rule = { secondPercent: 10, thirdPercent: 25, feeHeadIds: ['t'] };

  it('gives nothing to the first child, the second rate to the second, the third rate after', () => {
    expect(siblingPercent({ ...rule, rank: 1 })).toBe(0);
    expect(siblingPercent({ ...rule, rank: 2 })).toBe(10);
    expect(siblingPercent({ ...rule, rank: 3 })).toBe(25);
    expect(siblingPercent({ ...rule, rank: 5 })).toBe(25);
  });

  it('adds a labelled line on the chosen heads only, after any concession', () => {
    const transport = { feeHeadId: 'v', feeHeadName: 'Transport', frequency: FeeFrequency.MONTHLY, amount: 2000 };
    const lines = invoiceLines(
      [tuition, transport],
      [{ feeHeadId: 't', type: ConcessionType.FIXED, value: 1000 }],
      false,
      '2026-10',
      { ...rule, rank: 3 },
    );
    expect(lines).toEqual([
      { feeHeadId: 't', description: 'Tuition', amount: 5000 },
      { feeHeadId: 't', description: 'Tuition concession', amount: -1000 },
      { feeHeadId: 't', description: 'Tuition sibling discount (3rd child, 25%)', amount: -1000, kind: InvoiceLineKind.SIBLING_DISCOUNT },
      { feeHeadId: 'v', description: 'Transport', amount: 2000 },
    ]);
    expect(invoiceLines([tuition], [], false, '2026-10', { ...rule, rank: 1 })).toHaveLength(1);
  });

  it('never discounts below zero when a concession already covers the fee', () => {
    const lines = invoiceLines([tuition], [{ feeHeadId: 't', type: ConcessionType.PERCENT, value: 100 }], false, '2026-10', {
      ...rule,
      rank: 2,
    });
    expect(lines.reduce((sum, l) => sum + l.amount, 0)).toBe(0);
    expect(lines).toHaveLength(2);
  });
});

describe('lateFine', () => {
  it('charges per full day past the due date', () => {
    expect(lateFine(new Date('2026-10-10'), new Date('2026-10-13'), { perDay: 50 })).toBe(150);
    expect(lateFine(new Date('2026-10-10'), new Date('2026-10-09'), { perDay: 50 })).toBe(0);
  });

  it('stops at the most days charged and at the cap per voucher', () => {
    const due = new Date('2026-10-01');
    const asOf = new Date('2026-11-30'); // 60 days late
    expect(lateFine(due, asOf, { perDay: 50 })).toBe(3000);
    expect(lateFine(due, asOf, { perDay: 50, maxDays: 10 })).toBe(500);
    expect(lateFine(due, asOf, { perDay: 50, cap: 1200 })).toBe(1200);
    expect(lateFine(due, asOf, { perDay: 50, maxDays: 10, cap: 300 })).toBe(300);
    expect(lateFine(due, asOf, { perDay: 0, cap: 300 })).toBe(0);
  });
});

describe('fineDue', () => {
  const invoice = {
    dueDate: new Date('2026-10-10'),
    total: 5000,
    paid: 0,
    status: InvoiceStatus.UNPAID,
    fineBooked: 0,
    fineWaivedAt: null,
  };
  const asOf = new Date('2026-10-20'); // 10 days late
  const rule = { perDay: 50, cap: 400 };

  it('is the capped fine less what is already booked, so the two never double count', () => {
    expect(fineDue(invoice, asOf, rule)).toBe(400);
    expect(fineDue({ ...invoice, total: 5300, fineBooked: 300 }, asOf, rule)).toBe(100);
    expect(fineDue({ ...invoice, total: 5400, fineBooked: 400 }, asOf, rule)).toBe(0);
    expect(fineDue({ ...invoice, total: 5300, fineBooked: 300 }, asOf, { perDay: 50 })).toBe(200);
  });

  it('is nothing once waived, paid, cancelled or carried forward', () => {
    expect(fineDue({ ...invoice, fineWaivedAt: new Date() }, asOf, rule)).toBe(0);
    expect(fineDue({ ...invoice, paid: 5000, status: InvoiceStatus.PAID }, asOf, rule)).toBe(0);
    expect(fineDue({ ...invoice, status: InvoiceStatus.CANCELLED }, asOf, rule)).toBe(0);
    expect(fineDue({ ...invoice, status: InvoiceStatus.CARRIED_FORWARD }, asOf, rule)).toBe(0);
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

describe('invoiceStatus', () => {
  it('follows the money: unpaid, part paid, then paid', () => {
    expect(invoiceStatus(5000, 0)).toBe(InvoiceStatus.UNPAID);
    expect(invoiceStatus(5000, 2000)).toBe(InvoiceStatus.PARTIAL);
    expect(invoiceStatus(5000, 5000)).toBe(InvoiceStatus.PAID);
  });

  it('counts a late fine paid on top, and a nil voucher, as paid', () => {
    expect(invoiceStatus(5000, 5300)).toBe(InvoiceStatus.PAID);
    expect(invoiceStatus(0, 0)).toBe(InvoiceStatus.PAID);
  });
});
