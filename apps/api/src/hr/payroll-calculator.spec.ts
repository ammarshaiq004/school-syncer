import { PayItemType } from '@prisma/client';
import { calculatePayslip, daysBetween, workingDays } from './payroll-calculator.js';

describe('workingDays', () => {
  it('skips Sundays', () => {
    // October 2026 has 31 days and 4 Sundays.
    const days = workingDays('2026-10');
    expect(days).toHaveLength(27);
    expect(days).not.toContain('2026-10-04');
  });

  it('can skip Saturdays too', () => {
    expect(workingDays('2026-10', [0, 6])).toHaveLength(22);
  });
});

describe('daysBetween', () => {
  it('counts working days inclusively', () => {
    // Friday to Monday, with Sunday off.
    expect(daysBetween('2026-10-02', '2026-10-05')).toEqual(['2026-10-02', '2026-10-03', '2026-10-05']);
  });
});

describe('calculatePayslip', () => {
  const items = [
    { name: 'House rent', type: PayItemType.ALLOWANCE, amount: 5000 },
    { name: 'Provident fund', type: PayItemType.DEDUCTION, amount: 1500 },
  ];

  it('adds allowances and takes off deductions', () => {
    const slip = calculatePayslip({ basic: 40000, items, unpaidDays: 0, workingDays: 26 });
    expect(slip).toMatchObject({ allowances: 5000, deductions: 1500, unpaidDeduction: 0, net: 43500 });
    expect(slip.lines).toHaveLength(3);
  });

  it("takes a day's basic for each unpaid day", () => {
    const slip = calculatePayslip({ basic: 26000, items: [], unpaidDays: 2, workingDays: 26 });
    expect(slip).toMatchObject({ unpaidDeduction: 2000, net: 24000 });
    expect(slip.lines.at(-1)).toMatchObject({ name: 'Unpaid days (2)', amount: 2000 });
  });

  it('never goes below zero', () => {
    const slip = calculatePayslip({ basic: 10000, items: [{ name: 'Loan', type: PayItemType.DEDUCTION, amount: 20000 }], unpaidDays: 40, workingDays: 26 });
    expect(slip.unpaidDays).toBe(26);
    expect(slip.net).toBe(0);
  });
});
