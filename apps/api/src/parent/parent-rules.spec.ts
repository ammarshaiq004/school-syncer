import {
  attendanceTally,
  invoiceBreakdown,
  invoiceDisplayStatus,
  monthlyTallies,
} from './parent-rules.js';

const due = new Date('2026-10-10T00:00:00.000Z');

describe('invoiceDisplayStatus', () => {
  const inv = { status: 'UNPAID' as const, dueDate: due, total: 5000, paid: 0 };

  it('is pending up to and on the due date, overdue after', () => {
    expect(invoiceDisplayStatus(inv, '2026-10-01')).toBe('PENDING');
    expect(invoiceDisplayStatus(inv, '2026-10-10')).toBe('PENDING');
    expect(invoiceDisplayStatus(inv, '2026-10-11')).toBe('OVERDUE');
    expect(
      invoiceDisplayStatus(
        { ...inv, status: 'PARTIAL', paid: 2000 },
        '2026-10-11',
      ),
    ).toBe('OVERDUE');
  });

  it('is paid when settled and keeps cancelled', () => {
    expect(
      invoiceDisplayStatus(
        { ...inv, status: 'PAID', paid: 5000 },
        '2026-12-01',
      ),
    ).toBe('PAID');
    expect(invoiceDisplayStatus({ ...inv, paid: 5000 }, '2026-12-01')).toBe(
      'PAID',
    );
    expect(
      invoiceDisplayStatus({ ...inv, status: 'CANCELLED' }, '2026-12-01'),
    ).toBe('CANCELLED');
  });
});

describe('invoiceBreakdown', () => {
  const lines = [{ amount: 8000 }, { amount: 1500 }, { amount: -800 }];

  it('splits charges and concessions and adds the late fine to what is due', () => {
    expect(invoiceBreakdown(lines, { total: 8700, paid: 2000 }, 300)).toEqual({
      subtotal: 9500,
      discounts: 800,
      lateFine: 300,
      total: 8700,
      paid: 2000,
      balance: 6700,
      totalDue: 7000,
    });
  });

  it('owes nothing once paid', () => {
    expect(
      invoiceBreakdown(lines, { total: 8700, paid: 8700 }, 300),
    ).toMatchObject({
      balance: 0,
      lateFine: 0,
      totalDue: 0,
    });
  });
});

describe('attendanceTally', () => {
  it('counts late as attended and leave in the denominator', () => {
    expect(
      attendanceTally([
        'PRESENT',
        'PRESENT',
        'LATE',
        'ABSENT',
        'LEAVE',
        'PRESENT',
      ]),
    ).toEqual({
      present: 3,
      absent: 1,
      late: 1,
      leave: 1,
      total: 6,
      rate: 66.7,
    });
    expect(attendanceTally([]).rate).toBeNull();
  });

  it('groups by month, oldest first', () => {
    const months = monthlyTallies([
      { date: '2026-10-01', status: 'ABSENT' },
      { date: '2026-09-30', status: 'PRESENT' },
      { date: '2026-10-02', status: 'PRESENT' },
    ]);
    expect(months.map((m) => [m.month, m.total, m.rate])).toEqual([
      ['2026-09', 1, 100],
      ['2026-10', 2, 50],
    ]);
  });
});
