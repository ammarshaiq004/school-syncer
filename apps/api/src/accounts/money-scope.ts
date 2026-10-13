import type { Prisma } from '@prisma/client';
import { staffWhere } from '../hr/staff-where.js';

/**
 * Where-fragments that narrow the school's money to some campuses, for fee
 * staff limited to them (null scope = all of it): fees paid by their
 * campuses' students, entries booked to their campuses and salaries of staff
 * on their campuses. Entries with no campus are school-wide and left out.
 */
export function moneyScope(schoolId: string, scope: string[] | null) {
  return {
    invoices: (scope ? { student: { campusId: { in: scope } } } : {}) satisfies Prisma.InvoiceWhereInput,
    payments: (scope ? { invoice: { student: { campusId: { in: scope } } } } : {}) satisfies Prisma.PaymentWhereInput,
    entries: (scope ? { campusId: { in: scope } } : {}) satisfies Prisma.AccountEntryWhereInput,
    payslips: (scope ? { user: staffWhere(schoolId, scope) } : {}) satisfies Prisma.PayslipWhereInput,
  };
}
