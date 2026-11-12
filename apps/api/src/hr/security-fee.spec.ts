import { PayItemType } from '@prisma/client';
import { calculatePayslip } from './payroll-calculator.js';
import { securityHeld } from './security-fee.js';

describe('securityHeld', () => {
  const items = [
    { name: 'Security fee', type: PayItemType.DEDUCTION, amount: 1000 },
    { name: 'Provident fund', type: PayItemType.DEDUCTION, amount: 1500 },
    { name: 'House rent', type: PayItemType.ALLOWANCE, amount: 5000 },
  ];
  const slip = calculatePayslip({ basic: 30000, items, unpaidDays: 0, workingDays: 26 });

  it('counts only the deductions marked as security', () => {
    expect(securityHeld(slip.lines, ['Security fee'])).toBe(1000);
  });

  it('holds nothing when no item is marked', () => {
    expect(securityHeld(slip.lines, [])).toBe(0);
  });

  it('ignores an allowance with the same name', () => {
    expect(securityHeld(slip.lines, ['House rent'])).toBe(0);
  });
});
