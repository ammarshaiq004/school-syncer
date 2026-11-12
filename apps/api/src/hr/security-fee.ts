import { PayItemType } from '@prisma/client';

interface Line {
  name: string;
  type: PayItemType;
  amount: number;
}

/** What a finalised payslip held back as security: its deduction lines named after the employee's security pay items. */
export function securityHeld(lines: Line[], securityNames: string[]): number {
  const names = new Set(securityNames);
  return lines.filter((l) => l.type === PayItemType.DEDUCTION && names.has(l.name)).reduce((s, l) => s + l.amount, 0);
}
