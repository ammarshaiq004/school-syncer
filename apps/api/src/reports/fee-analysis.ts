/** Pure parts of the fee reports, kept apart so they can be tested without a database. */

export interface DiscountLine {
  kind: 'FEE' | 'SIBLING_DISCOUNT' | 'ADJUSTMENT' | 'LATE_FINE' | 'ARREARS';
  amount: number;
}

/** What a negative voucher line is called on the discount report; null if it is not a discount. */
export function discountKind(line: DiscountLine): string | null {
  if (line.amount >= 0) return null;
  switch (line.kind) {
    case 'FEE':
      return 'Concession';
    case 'SIBLING_DISCOUNT':
      return 'Sibling discount';
    case 'ADJUSTMENT':
      return 'Fee office discount';
    case 'LATE_FINE':
      return 'Late fine waived';
    default:
      return null;
  }
}

/** The YYYY-MM a payment was received in, for comparing with the month a voucher bills. */
export const isAdvance = (invoicePeriod: string, receivedMonth: string) => invoicePeriod > receivedMonth;

export interface OpenMonth {
  studentId: string;
  period: string;
  balance: number;
}

/** Students owing `min` or more monthly vouchers, with the months and the total owed, biggest debt first. */
export function multiMonth(open: OpenMonth[], min: number) {
  const by = new Map<string, { studentId: string; periods: string[]; balance: number }>();
  for (const o of open) {
    const row = by.get(o.studentId) ?? { studentId: o.studentId, periods: [], balance: 0 };
    row.periods.push(o.period);
    row.balance += o.balance;
    by.set(o.studentId, row);
  }
  return [...by.values()]
    .filter((r) => r.periods.length >= min)
    .map((r) => ({ ...r, periods: r.periods.sort() }))
    .sort((a, b) => b.balance - a.balance || b.periods.length - a.periods.length);
}

/** Percentage rounded to one decimal; 0 when there is nothing to divide by. */
export const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
