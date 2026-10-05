import {
  directoryQuerySchema,
  feeStatusOf,
  feeSummary,
  percentsFromMarks,
  percentsFromResult,
} from './student-directory.js';

describe('feeStatusOf', () => {
  const today = '2026-10-15';
  it('is OVERDUE when any open invoice is past due', () => {
    expect(feeStatusOf([{ dueDate: '2026-10-20' }, { dueDate: '2026-10-10' }], today)).toBe('OVERDUE');
  });
  it('is PENDING when open invoices are not yet due (due today is not overdue)', () => {
    expect(feeStatusOf([{ dueDate: '2026-10-15' }], today)).toBe('PENDING');
  });
  it('is PAID with nothing open', () => {
    expect(feeStatusOf([], today)).toBe('PAID');
  });
});

describe('feeSummary', () => {
  it('totals live invoices and splits out the overdue balance', () => {
    expect(
      feeSummary(
        [
          { total: 5000, paid: 5000, status: 'PAID', dueDate: '2026-09-10' },
          { total: 5000, paid: 2000, status: 'PARTIAL', dueDate: '2026-10-10' },
          { total: 5000, paid: 0, status: 'UNPAID', dueDate: '2026-11-10' },
          { total: 9000, paid: 0, status: 'CANCELLED', dueDate: '2026-08-10' },
        ],
        '2026-10-15',
      ),
    ).toEqual({
      totalBilled: 15000,
      totalPaid: 7000,
      balance: 8000,
      overdueBalance: 3000,
      openInvoices: 2,
      status: 'OVERDUE',
    });
  });
});

describe('subject percents', () => {
  it('reads a published result, absent as zero, skipping unentered papers', () => {
    expect(
      percentsFromResult([
        { subject: 'Maths', max: 50, pass: 20, marks: 42, absent: false, passed: true },
        { subject: 'English', max: 50, pass: 20, marks: null, absent: true, passed: false },
        { subject: 'Urdu', max: 50, pass: 20, marks: null, absent: false, passed: false },
      ]),
    ).toEqual([
      { subject: 'Maths', percent: 84 },
      { subject: 'English', percent: 0 },
    ]);
  });

  it('falls back to totals across papers per subject', () => {
    expect(
      percentsFromMarks([
        { subject: 'Maths', marks: 40, isAbsent: false, max: 50 },
        { subject: 'Maths', marks: 30, isAbsent: false, max: 100 },
        { subject: 'Science', marks: null, isAbsent: true, max: 25 },
        { subject: 'Urdu', marks: null, isAbsent: false, max: 25 },
      ]),
    ).toEqual([
      { subject: 'Maths', percent: 46.7 },
      { subject: 'Science', percent: 0 },
    ]);
  });
});

describe('directoryQuerySchema', () => {
  it('applies defaults', () => {
    expect(directoryQuerySchema.parse({})).toMatchObject({
      page: 1,
      pageSize: 25,
      classId: [],
      status: [],
      feeStatus: [],
      sort: 'name',
      dir: 'asc',
    });
  });
  it('accepts comma lists and repeated params, and caps the page size', () => {
    const q = directoryQuerySchema.parse({ feeStatus: 'OVERDUE,PENDING,OVERDUE', sectionId: ['s1', 's2'], page: '3' });
    expect(q.feeStatus).toEqual(['OVERDUE', 'PENDING']);
    expect(q.sectionId).toEqual(['s1', 's2']);
    expect(q.page).toBe(3);
    expect(directoryQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
    expect(directoryQuerySchema.safeParse({ feeStatus: 'LATE' }).success).toBe(false);
    expect(directoryQuerySchema.safeParse({ sort: 'dob' }).success).toBe(false);
  });
});
